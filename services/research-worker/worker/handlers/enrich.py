"""On-demand enrichment for one shortlisted lead (Phase 2A).

Three independent, bounded stages — public contact research, optional Hunter,
optional AI opportunity analysis — each failing gracefully. Nothing here mutates
Phase 1 data: findings are written to enrichment_runs / external_evidence /
external_contacts / provider_usage and shown as candidates or hypotheses until
the operator confirms them.
"""

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urlparse

import psycopg

from worker import providers
from worker.adapters.search import is_aggregator, make_search_adapter
from worker.config import settings
from worker.crawler import make_fetcher
from worker.db import jsonb
from worker.enrichment import (
    MAX_BRAVE_QUERIES,
    MAX_EXTERNAL_PAGES,
    ExternalCandidate,
    assess_contact_readiness,
    build_queries,
    classify_email_type,
    classify_person,
    make_candidate,
    sanitize_ai_analysis,
    should_skip_enrichment,
)
from worker.queue import Task

log = logging.getLogger(__name__)

_BLOCK_STATUSES = {"rejected", "do_not_contact"}
_NAME_RE = re.compile(r"[A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2}")
_ROLE_HINTS = (
    "registered agent",
    "owner",
    "founder",
    "co-founder",
    "president",
    "ceo",
    "principal",
    "proprietor",
    "operations manager",
    "office manager",
    "general manager",
    "service manager",
    "project manager",
)


def is_enrichable(
    status: str, validation_status: str, validation_overridden: bool, suppressed: bool
) -> bool:
    """Enrichment is allowed only for shortlisted leads (pure, unit-tested)."""
    if suppressed or status in _BLOCK_STATUSES:
        return False
    if validation_status == "invalid" and not validation_overridden:
        return False
    if validation_overridden or validation_status == "valid":
        return True
    return status in {"qualified", "needs_review", "approved"}


def _domain_of(url: str | None) -> str | None:
    if not url:
        return None
    host = (urlparse(url).hostname or "").lower()
    return host.removeprefix("www.") or None


def _scan_candidates(
    text: str, source: str, method: str, source_url: str | None
) -> list[ExternalCandidate]:
    """Heuristically pull (person, role-context) pairs from snippet/page text."""
    out: list[ExternalCandidate] = []
    low = text.lower()
    for hint in _ROLE_HINTS:
        start = 0
        while True:
            idx = low.find(hint, start)
            if idx == -1:
                break
            start = idx + len(hint)
            window = text[max(0, idx - 60) : idx + len(hint) + 60]
            name_match = _NAME_RE.search(window)
            if not name_match:
                continue
            cand = make_candidate(
                name_match.group(0),
                window,
                source=source,
                method=method,
                source_url=source_url,
                excerpt=window.strip(),
            )
            if cand and not any(c.name == cand.name and c.role_type == cand.role_type for c in out):
                out.append(cand)
            if len(out) >= 10:
                return out
    return out


def _suppressed(conn: psycopg.Connection, business: dict) -> bool:
    row = conn.execute(
        """select 1 from suppression_list
           where (domain is not null and lower(domain) = lower(%s))
              or (email is not null and lower(email) = lower(%s))
              or (phone is not null and phone = %s)
           limit 1""",
        (business.get("domain"), business.get("email"), business.get("phone")),
    ).fetchone()
    return row is not None


def _industries(conn: psycopg.Connection, business: dict) -> list[str]:
    if business.get("campaign_id"):
        rows = conn.execute(
            "select industry from campaign_industries where campaign_id = %s",
            (business["campaign_id"],),
        ).fetchall()
        if rows:
            return [r["industry"] for r in rows]
    return [business["industry"]] if business.get("industry") else []


def _record_usage(conn: psycopg.Connection, run_id: str, r: providers.ProviderResult) -> None:
    conn.execute(
        """insert into provider_usage
             (run_id, provider, operation, request_count, model, input_tokens, output_tokens,
              started_at, completed_at, success, error, cache_hit)
           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false)""",
        (
            run_id,
            r.provider,
            r.operation,
            r.request_count,
            r.model,
            r.input_tokens,
            r.output_tokens,
            r.started_at,
            r.completed_at,
            r.success,
            r.error,
        ),
    )


def _insert_candidate(
    conn: psycopg.Connection, run_id: str, business_id: str, c: ExternalCandidate
) -> None:
    conn.execute(
        """insert into external_contacts
             (run_id, business_id, name, role, role_type, company_association, email, email_type,
              source, provider, source_url, excerpt, confidence, verification_state, method,
              provider_score)
           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            run_id,
            business_id,
            c.name,
            c.role,
            c.role_type,
            c.company_association,
            c.email,
            c.email_type,
            c.source,
            c.provider,
            c.source_url,
            c.excerpt,
            c.confidence,
            c.verification_state,
            c.method,
            c.provider_score,
        ),
    )


# ── stage 1: public contact research ─────────────────────────────────


def _stage_public_research(
    conn: psycopg.Connection, run_id: str, business: dict
) -> tuple[dict, list[ExternalCandidate]]:
    stage: dict = {"status": "ok"}
    candidates: list[ExternalCandidate] = []
    business_domain = business.get("domain")
    try:
        queries = build_queries(
            business["name"],
            business_domain,
            business.get("city"),
            business.get("state"),
            (_industries(conn, business) or [None])[0],
        )
        adapter = make_search_adapter()
        promising: list[str] = []
        seen_urls: set[str] = set()
        query_count = 0
        for query in queries[:MAX_BRAVE_QUERIES]:
            query_count += 1
            for res in adapter.search(query, count=10):
                dom = _domain_of(res.url)
                verification = "likely" if dom and dom == business_domain else "unverified"
                conn.execute(
                    """insert into external_evidence
                         (run_id, business_id, query, title, url, domain, snippet,
                          evidence_type, confidence, verification_state)
                       values (%s,%s,%s,%s,%s,%s,%s,'search_result',%s,%s)""",
                    (
                        run_id,
                        business["id"],
                        query,
                        res.title,
                        res.url,
                        dom,
                        res.snippet,
                        "low",
                        verification,
                    ),
                )
                candidates.extend(
                    _scan_candidates(res.snippet or "", "brave", "search_snippet", res.url)
                )
                if res.url not in seen_urls and not is_aggregator(dom):
                    seen_urls.add(res.url)
                    promising.append(res.url)

        pages_fetched = 0
        fetcher = make_fetcher()
        try:
            for url in promising:
                if pages_fetched >= MAX_EXTERNAL_PAGES:
                    break
                page = fetcher.fetch(url)
                pages_fetched += 1
                if page.error or not page.text:
                    continue
                candidates.extend(_scan_candidates(page.text, "page", "page_extraction", url))
        finally:
            fetcher.close()

        stage.update(queries=query_count, pages_fetched=pages_fetched, candidates=len(candidates))
    except Exception as exc:  # noqa: BLE001 - stage isolation
        log.warning("public research stage failed for %s: %s", business["id"], exc)
        stage = {"status": "error", "error": f"{type(exc).__name__}: {exc}"}
    return stage, candidates


# ── stage 2: optional Hunter ─────────────────────────────────────────


def _stage_hunter(
    conn: psycopg.Connection, run_id: str, business: dict
) -> tuple[dict, list[ExternalCandidate]]:
    domain = business.get("domain")
    result = providers.hunter_domain_search(domain or "")
    _record_usage(conn, run_id, result)
    if not result.configured:
        return {"status": "skipped", "reason": result.error}, []
    if not result.success:
        return {"status": "error", "error": result.error}, []

    manual_emails = {
        (r["email"] or "").lower()
        for r in conn.execute(
            "select email from business_contacts where business_id = %s and email is not null",
            (business["id"],),
        ).fetchall()
    }
    candidates: list[ExternalCandidate] = []
    for item in (result.data.get("emails") or [])[:10]:
        email = item.get("value")
        if not email or email.lower() in manual_emails:  # never overwrite a manual contact
            continue
        name = " ".join(x for x in (item.get("first_name"), item.get("last_name")) if x) or None
        position = item.get("position") or item.get("department") or ""
        role_type, _ = classify_person(name or "", position)
        is_generic = (item.get("type") or "").lower() == "generic"
        candidates.append(
            ExternalCandidate(
                name=name or email,
                role=position or None,
                role_type=role_type if name else "unknown",
                company_association=business["name"],
                source="hunter",
                method="provider",
                verification_state="unverified",  # provider-suggested, never auto-confirmed
                confidence="medium" if item.get("confidence", 0) >= 80 else "low",
                email=email,
                email_type=classify_email_type(email, provider_pattern=is_generic and not name),
                provider="hunter",
                source_url=(item.get("sources") or [{}])[0].get("uri")
                if item.get("sources")
                else None,
                excerpt=f"Hunter confidence {item.get('confidence')}",
                provider_score=item.get("confidence"),
            )
        )
    return {"status": "ok", "emails": len(candidates)}, candidates


# ── stage 3: optional AI opportunity analysis ────────────────────────


def _build_ai_evidence(
    conn: psycopg.Connection, run_id: str, business_id: str
) -> tuple[list[dict], set[str]]:
    evidence: list[dict] = []
    for i, r in enumerate(
        conn.execute(
            """select fact_key, value, source_url from extracted_facts
               where business_id = %s and confidence in ('confirmed','high')
                 and method in ('regex','heuristic','manual','import') limit 25""",
            (business_id,),
        ).fetchall(),
        start=1,
    ):
        evidence.append(
            {
                "id": f"F{i}",
                "type": "fact",
                "text": f"{r['fact_key']}: {r['value']}",
                "source_url": r["source_url"],
            }
        )
    for i, r in enumerate(
        conn.execute(
            """select e.label, e.evidence, e.source_url from qualification_evidence e
               join qualification_runs q on q.id = e.run_id
               where q.business_id = %s and e.points > 0
               order by q.created_at desc limit 15""",
            (business_id,),
        ).fetchall(),
        start=1,
    ):
        evidence.append(
            {
                "id": f"Q{i}",
                "type": "signal",
                "text": f"{r['label']}: {r['evidence']}",
                "source_url": r["source_url"],
            }
        )
    for i, r in enumerate(
        conn.execute(
            "select title, snippet, url from external_evidence where run_id = %s limit 20",
            (run_id,),
        ).fetchall(),
        start=1,
    ):
        evidence.append(
            {
                "id": f"E{i}",
                "type": "external",
                "text": f"{r['title']}: {r['snippet']}",
                "source_url": r["url"],
            }
        )
    return evidence, {e["id"] for e in evidence}


def _stage_ai(
    conn: psycopg.Connection, run_id: str, business: dict, contacts: list[ExternalCandidate]
) -> tuple[dict, dict | None]:
    evidence, valid_ids = _build_ai_evidence(conn, run_id, business["id"])
    payload = {
        "business": {
            "name": business["name"],
            "domain": business.get("domain"),
            "city": business.get("city"),
            "state": business.get("state"),
            "industry": business.get("industry"),
        },
        "campaign_industries": _industries(conn, business),
        "evidence": evidence,
        "contacts": [
            {"name": c.name, "role": c.role, "verification_state": c.verification_state}
            for c in contacts
        ],
    }
    result = providers.ai_opportunity_brief(payload)
    _record_usage(conn, run_id, result)
    if not result.configured:
        return {"status": "skipped", "reason": result.error}, None
    if not result.success:
        return {"status": "error", "error": result.error}, None
    analysis = sanitize_ai_analysis(result.data.get("raw_json"), valid_ids)
    return {"status": "ok", "evidence_count": len(evidence)}, analysis


# ── orchestration ────────────────────────────────────────────────────


def handle_enrich_lead(conn: psycopg.Connection, task: Task) -> None:
    business = conn.execute(
        "select * from businesses where id = %s", (task.business_id,)
    ).fetchone()
    if business is None:
        raise RuntimeError(f"business {task.business_id} not found")

    force = bool(task.payload.get("force"))
    suppressed = _suppressed(conn, business)
    if not is_enrichable(
        business["status"],
        business["validation_status"],
        business["validation_overridden"],
        suppressed,
    ):
        log.info("enrichment refused for %s (not a shortlisted lead)", task.business_id)
        conn.execute(
            """insert into enrichment_runs
                 (business_id, status, error, completed_at, force)
               values (%s, 'skipped', 'lead is not eligible for enrichment', now(), %s)""",
            (task.business_id, force),
        )
        return

    last = conn.execute(
        """select completed_at from enrichment_runs
           where business_id = %s and status in ('completed','partial')
           order by completed_at desc limit 1""",
        (task.business_id,),
    ).fetchone()
    if should_skip_enrichment(
        last["completed_at"] if last else None, datetime.now(UTC), force, settings.enrich_cache_days
    ):
        log.info(
            "enrichment cache hit for %s (fresh run within %dd)",
            task.business_id,
            settings.enrich_cache_days,
        )
        conn.execute(
            """insert into enrichment_runs
                 (business_id, status, cache_hit, completed_at, force)
               values (%s, 'skipped', true, now(), %s)""",
            (task.business_id, force),
        )
        return

    row = conn.execute(
        "insert into enrichment_runs (business_id, status, force) values (%s, 'running', %s) returning id",
        (task.business_id, force),
    ).fetchone()
    run_id = str(row["id"])

    research_stage, research_candidates = _stage_public_research(conn, run_id, business)
    hunter_stage, hunter_candidates = _stage_hunter(conn, run_id, business)

    all_candidates = research_candidates + hunter_candidates
    for cand in all_candidates:
        _insert_candidate(conn, run_id, business["id"], cand)

    ai_stage, analysis = _stage_ai(conn, run_id, business, all_candidates)

    readiness = _contact_readiness(conn, business, all_candidates)
    stages = {"public_research": research_stage, "hunter": hunter_stage, "ai": ai_stage}
    status = "partial" if any(s.get("status") == "error" for s in stages.values()) else "completed"
    conn.execute(
        """update enrichment_runs
           set status = %s, contact_readiness = %s, stages = %s, ai_analysis = %s,
               completed_at = now()
           where id = %s""",
        (status, readiness, jsonb(stages), jsonb(analysis) if analysis else None, run_id),
    )
    log.info(
        "enriched %s: %s, readiness=%s, %d candidates",
        task.business_id,
        status,
        readiness,
        len(all_candidates),
    )


def _contact_readiness(
    conn: psycopg.Connection, business: dict, candidates: list[ExternalCandidate]
) -> str:
    verified = conn.execute(
        """select 1 from business_contacts
           where business_id = %s and is_decision_maker
             and (email is not null or phone is not null) limit 1""",
        (business["id"],),
    ).fetchone()
    has_general = bool(
        business.get("email") or business.get("phone") or business.get("website_url")
    )
    has_uncertain = any(
        c.name and c.verification_state in ("likely", "unverified", "conflicting")
        for c in candidates
    )
    return assess_contact_readiness(
        do_not_contact=business["status"] == "do_not_contact",
        has_verified_direct_contact=verified is not None,
        has_general_channel=has_general,
        has_uncertain_candidate=has_uncertain,
    )
