"""Research: crawl the business website, store pages, extract facts + contacts."""

import logging

import psycopg

from worker import queue
from worker.crawler import crawl_site
from worker.db import jsonb
from worker.extraction import ROLE_TYPES, dedupe_facts, extract_from_page
from worker.normalize import parse_city_state
from worker.queue import Task

log = logging.getLogger(__name__)

GENERIC_EMAIL_PREFIXES = ("info@", "office@", "contact@", "hello@", "sales@", "admin@", "service@")


def handle_research_website(conn: psycopg.Connection, task: Task) -> None:
    business = conn.execute(
        "select * from businesses where id = %s", (task.business_id,)
    ).fetchone()
    if business is None:
        raise RuntimeError(f"business {task.business_id} not found")
    if not business["website_url"]:
        conn.execute(
            "update businesses set status = 'research_failed', notes = coalesce(notes, '') || %s where id = %s",
            ("\n[worker] no website URL to research", task.business_id),
        )
        return

    conn.execute("update businesses set status = 'researching' where id = %s", (task.business_id,))

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
                 crawl_allowed = excluded.crawl_allowed, fetched_at = now()""",
            (
                task.business_id,
                page.url,
                page.title,
                page.http_status,
                page.text,
                page.content_hash,
                page.crawl_allowed,
                jsonb({"error": page.error} if page.error else {}),
            ),
        )
        stored += 1

    if stored == 0:
        conn.execute(
            "update businesses set status = 'research_failed' where id = %s", (task.business_id,)
        )
        log.warning(
            "no pages fetched for business %s (%s)", task.business_id, business["website_url"]
        )
        return

    conn.execute("update businesses set researched_at = now() where id = %s", (task.business_id,))
    queue.enqueue(conn, "extract_facts", campaign_id=task.campaign_id, business_id=task.business_id)
    log.info("stored %d pages for business %s", stored, task.business_id)


def handle_extract_facts(conn: psycopg.Connection, task: Task) -> None:
    pages = conn.execute(
        """select id, url, content_text from website_pages
           where business_id = %s and content_text is not null""",
        (task.business_id,),
    ).fetchall()
    if not pages:
        raise RuntimeError(f"no pages to extract for business {task.business_id}")

    all_facts = []
    page_ids: dict[str, str] = {}
    for page in pages:
        page_ids[page["url"]] = str(page["id"])
        all_facts.extend(extract_from_page(page["url"], page["content_text"]))
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

    _sync_contacts(conn, task.business_id, facts)
    _fill_business_fields(conn, task.business_id, facts)

    queue.enqueue(
        conn, "score_business", campaign_id=task.campaign_id, business_id=task.business_id
    )
    log.info("extracted %d facts for business %s", len(facts), task.business_id)


def _sync_contacts(conn: psycopg.Connection, business_id: str | None, facts: list) -> None:
    """Create contacts from person_role facts; attach published emails."""
    emails = [f for f in facts if f.key == "email"]
    for fact in facts:
        if fact.key != "person_role":
            continue
        name, _, role = fact.value.partition("|")
        role_type = ROLE_TYPES.get(role, "other")
        exists = conn.execute(
            "select 1 from business_contacts where business_id = %s and lower(name) = lower(%s)",
            (business_id, name),
        ).fetchone()
        if exists:
            continue
        # Only attach an email if it plausibly belongs to this person (first or
        # full name in the local part). Never invent or pattern-guess.
        matched_email = next(
            (e.value for e in emails if name.split()[0].lower() in e.value.split("@")[0].lower()),
            None,
        )
        conn.execute(
            """insert into business_contacts
                 (business_id, name, role, role_type, email, email_source,
                  email_confidence, source_url, excerpt, is_decision_maker)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                business_id,
                name.strip(),
                role,
                role_type,
                matched_email,
                "website_published" if matched_email else None,
                "confirmed" if matched_email else None,
                fact.source_url,
                fact.excerpt,
                role_type
                in (
                    "owner",
                    "founder",
                    "general_manager",
                    "operations_manager",
                    "office_manager",
                    "service_manager",
                    "project_manager",
                ),
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
                     (business_id, email, email_source, email_confidence, source_url, excerpt)
                   values (%s, %s, 'website_published', 'confirmed', %s, %s)""",
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
