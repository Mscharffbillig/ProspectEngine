"""Research: crawl the business website, store pages, extract facts + contacts,
resolve the canonical business identity."""

import logging

import psycopg

from worker import queue
from worker.crawler import FetchedPage, crawl_site
from worker.db import jsonb
from worker.extraction import dedupe_facts, extract_from_page
from worker.identity import resolve_company_name
from worker.normalize import normalize_company_name, parse_city_state
from worker.people import Person, extract_people
from worker.queue import Task

log = logging.getLogger(__name__)

GENERIC_EMAIL_PREFIXES = ("info@", "office@", "contact@", "hello@", "sales@", "admin@", "service@")

# Statuses the pipeline may move through "researching"; manual decisions
# (approved, contacted, replied, ...) are never clobbered by reprocessing.
_AUTO_STATUSES = ("unresearched", "researching", "research_failed", "qualified", "needs_review")

_NAME_RANK = {"manual": 5, "confirmed": 4, "high": 3, "medium": 2, "low": 1, None: 0}


def handle_research_website(conn: psycopg.Connection, task: Task) -> None:
    business = conn.execute(
        "select * from businesses where id = %s", (task.business_id,)
    ).fetchone()
    if business is None:
        raise RuntimeError(f"business {task.business_id} not found")
    if not business["website_url"]:
        conn.execute(
            "update businesses set status = 'research_failed', "
            "notes = coalesce(notes, '') || %s where id = %s",
            ("\n[worker] no website URL to research", task.business_id),
        )
        return

    if business["status"] in _AUTO_STATUSES:
        conn.execute(
            "update businesses set status = 'researching' where id = %s", (task.business_id,)
        )

    pages = crawl_site(business["website_url"])
    stored = 0
    for page in pages:
        conn.execute(
            """insert into website_pages
                 (business_id, url, title, http_status, content_text, content_hash,
                  crawl_allowed, extraction_meta)
               values (%s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (business_id, url) do update set
                 title = excluded.title, http_status = excluded.http_status,
                 content_text = excluded.content_text, content_hash = excluded.content_hash,
                 crawl_allowed = excluded.crawl_allowed,
                 extraction_meta = excluded.extraction_meta, fetched_at = now()""",
            (
                task.business_id,
                page.url,
                page.title,
                page.http_status,
                page.text,
                page.content_hash,
                page.crawl_allowed,
                jsonb(page.meta | ({"error": page.error} if page.error else {})),
            ),
        )
        stored += 1

    if stored == 0:
        conn.execute(
            "update businesses set status = 'research_failed', "
            "validation_status = 'invalid', validation_reasons = %s where id = %s",
            (jsonb(["crawl_failed"]), task.business_id),
        )
        log.warning(
            "no pages fetched for business %s (%s)", task.business_id, business["website_url"]
        )
        return

    conn.execute("update businesses set researched_at = now() where id = %s", (task.business_id,))
    queue.enqueue(conn, "extract_facts", campaign_id=task.campaign_id, business_id=task.business_id)
    log.info("stored %d pages for business %s", stored, task.business_id)


def _load_pages(conn: psycopg.Connection, business_id: str | None) -> list[FetchedPage]:
    rows = conn.execute(
        """select url, title, http_status, content_text, extraction_meta
           from website_pages where business_id = %s and content_text is not null
           order by created_at""",
        (business_id,),
    ).fetchall()
    return [
        FetchedPage(
            url=r["url"],
            title=r["title"],
            http_status=r["http_status"],
            text=r["content_text"] or "",
            content_hash="",
            meta=r["extraction_meta"] or {},
        )
        for r in rows
    ]


def handle_extract_facts(conn: psycopg.Connection, task: Task) -> None:
    pages = _load_pages(conn, task.business_id)
    if not pages:
        raise RuntimeError(f"no pages to extract for business {task.business_id}")

    page_ids = {
        r["url"]: str(r["id"])
        for r in conn.execute(
            "select id, url from website_pages where business_id = %s", (task.business_id,)
        ).fetchall()
    }

    all_facts = []
    for page in pages:
        all_facts.extend(extract_from_page(page.url, page.text))
    facts = dedupe_facts(all_facts)

    # Re-extraction is idempotent: replace previous automated facts, keep manual ones.
    conn.execute(
        "delete from extracted_facts where business_id = %s and method in ('regex', 'heuristic')",
        (task.business_id,),
    )
    for fact in facts:
        conn.execute(
            """insert into extracted_facts
                 (business_id, fact_key, value, confidence, source_url, excerpt, method, page_id)
               values (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                task.business_id,
                fact.key,
                fact.value,
                fact.confidence,
                fact.source_url,
                fact.excerpt,
                fact.method,
                page_ids.get(fact.source_url),
            ),
        )

    _resolve_identity(conn, task.business_id, pages)
    people = extract_people(pages)
    _sync_contacts(conn, task.business_id, people, facts)
    _fill_business_fields(conn, task.business_id, facts)

    queue.enqueue(
        conn, "score_business", campaign_id=task.campaign_id, business_id=task.business_id
    )
    log.info(
        "extracted %d facts, %d people for business %s", len(facts), len(people), task.business_id
    )


def _resolve_identity(
    conn: psycopg.Connection, business_id: str | None, pages: list[FetchedPage]
) -> None:
    """Resolve the canonical company name; never downgrade a better name."""
    business = conn.execute(
        "select name, name_confidence from businesses where id = %s", (business_id,)
    ).fetchone()
    if business is None:
        return
    resolution = resolve_company_name(pages, business["name"])

    conn.execute(
        "delete from extracted_facts where business_id = %s and fact_key = 'company_name'",
        (business_id,),
    )
    conn.execute(
        """insert into extracted_facts
             (business_id, fact_key, value, confidence, source_url, excerpt, method)
           values (%s, 'company_name', %s, %s, %s, %s, 'heuristic')""",
        (
            business_id,
            resolution.name,
            resolution.confidence,
            resolution.source_url,
            f"[{resolution.source}] {resolution.evidence}"[:300],
        ),
    )

    current_rank = _NAME_RANK.get(business["name_confidence"], 0)
    new_rank = _NAME_RANK.get(resolution.confidence, 0)
    if new_rank > current_rank:
        conn.execute(
            """update businesses set name = %s, normalized_name = %s,
               name_confidence = %s, name_source = %s where id = %s""",
            (
                resolution.name,
                normalize_company_name(resolution.name),
                resolution.confidence,
                resolution.source,
                business_id,
            ),
        )
        log.info(
            "resolved name for %s: %r (%s via %s)",
            business_id,
            resolution.name,
            resolution.confidence,
            resolution.source,
        )


def _sync_contacts(
    conn: psycopg.Connection, business_id: str | None, people: list[Person], facts: list
) -> None:
    """Replace automated contacts with validated people; manual contacts kept."""
    conn.execute(
        "delete from business_contacts where business_id = %s and method = 'auto'",
        (business_id,),
    )
    manual_names = {
        (r["name"] or "").lower()
        for r in conn.execute(
            "select name from business_contacts where business_id = %s", (business_id,)
        ).fetchall()
    }

    emails = [f for f in facts if f.key == "email"]
    for person in people:
        if person.name.lower() in manual_names:
            continue
        # Only attach an email if it plausibly belongs to this person (first or
        # last name in the local part). Never invent or pattern-guess.
        matched_email = next(
            (
                e.value
                for e in emails
                if any(t.lower() in e.value.split("@")[0].lower() for t in person.name.split())
            ),
            None,
        )
        conn.execute(
            """insert into business_contacts
                 (business_id, name, role, role_type, email, email_source, email_confidence,
                  source_url, excerpt, is_decision_maker, method, name_confidence)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'auto', %s)""",
            (
                business_id,
                person.name,
                person.role,
                person.role_type,
                matched_email,
                "website_published" if matched_email else None,
                "confirmed" if matched_email else None,
                person.source_url,
                person.excerpt,
                person.decision_maker_eligible,
                person.confidence,
            ),
        )

    # Store a generic business email as a role-less contact record if none exists.
    generic = next((e for e in emails if e.value.startswith(GENERIC_EMAIL_PREFIXES)), None) or (
        emails[0] if emails else None
    )
    if generic:
        exists = conn.execute(
            "select 1 from business_contacts where business_id = %s and lower(email) = lower(%s)",
            (business_id, generic.value),
        ).fetchone()
        if not exists:
            conn.execute(
                """insert into business_contacts
                     (business_id, email, email_source, email_confidence, source_url, excerpt,
                      method, name_confidence)
                   values (%s, %s, 'website_published', 'confirmed', %s, %s, 'auto', null)""",
                (business_id, generic.value, generic.source_url, generic.excerpt),
            )


def _fill_business_fields(conn: psycopg.Connection, business_id: str | None, facts: list) -> None:
    """Fill empty business columns from confirmed/high-confidence facts."""

    def first_value(key: str) -> str | None:
        return next((f.value for f in facts if f.key == key), None)

    address = first_value("address")
    city_state = parse_city_state(address) if address else None
    conn.execute(
        """update businesses set
             phone = coalesce(phone, %s),
             email = coalesce(email, %s),
             address = coalesce(address, %s),
             city = coalesce(city, %s),
             state = coalesce(state, %s)
           where id = %s""",
        (
            first_value("phone"),
            first_value("email"),
            address,
            city_state[0] if city_state else None,
            city_state[1] if city_state else None,
            business_id,
        ),
    )
