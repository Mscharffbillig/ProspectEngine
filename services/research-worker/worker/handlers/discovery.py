"""Discovery: search-API candidate discovery and CSV import processing."""

import logging

import psycopg

from worker import queue
from worker.adapters.search import generate_queries, is_aggregator, make_search_adapter
from worker.db import jsonb
from worker.handlers.candidates import Candidate, _load_existing, upsert_candidate
from worker.normalize import normalize_domain
from worker.queue import Task

log = logging.getLogger(__name__)


def handle_discover_candidates(conn: psycopg.Connection, task: Task) -> None:
    campaign = conn.execute("select * from campaigns where id = %s", (task.campaign_id,)).fetchone()
    if campaign is None:
        raise RuntimeError(f"campaign {task.campaign_id} not found")

    industries = [
        r["industry"]
        for r in conn.execute(
            "select industry from campaign_industries where campaign_id = %s", (task.campaign_id,)
        ).fetchall()
    ]
    locations = [
        r["location"]
        for r in conn.execute(
            "select location from campaign_locations where campaign_id = %s", (task.campaign_id,)
        ).fetchall()
    ]

    run_id = task.payload.get("research_run_id")
    if run_id is None:
        row = conn.execute(
            "insert into research_runs (campaign_id) values (%s) returning id", (task.campaign_id,)
        ).fetchone()
        assert row is not None
        run_id = str(row["id"])

    stats = {
        "queries": 0,
        "raw_results": 0,
        "skipped_aggregators": 0,
        "new_businesses": 0,
        "merged": 0,
        "suppressed_or_skipped": 0,
    }
    try:
        adapter = make_search_adapter()
        existing = _load_existing(conn)
        max_candidates = campaign["max_candidates_per_run"]
        new_business_ids: list[str] = []
        seen_domains: set[str] = set()

        for query in generate_queries(industries, locations):
            if stats["new_businesses"] >= max_candidates:
                break
            stats["queries"] += 1
            log.info("search: %r", query)
            for result in adapter.search(query):
                if stats["new_businesses"] >= max_candidates:
                    break
                stats["raw_results"] += 1
                domain = normalize_domain(result.url)
                if is_aggregator(domain):
                    stats["skipped_aggregators"] += 1
                    continue
                if domain in seen_domains:
                    continue  # same-domain result already handled this run
                seen_domains.add(domain or "")

                candidate = Candidate(
                    name=_title_to_name(result.title),
                    website_url=result.url,
                    source_type="search_api",
                    query=result.query,
                    title=result.title,
                    url=result.url,
                    snippet=result.snippet,
                    rank=result.rank,
                )
                upserted = upsert_candidate(conn, candidate, task.campaign_id, existing)
                if upserted is None:
                    stats["suppressed_or_skipped"] += 1
                elif upserted.created:
                    stats["new_businesses"] += 1
                    new_business_ids.append(upserted.business_id)
                else:
                    stats["merged"] += 1

        for business_id in new_business_ids:
            queue.enqueue(
                conn, "research_website", campaign_id=task.campaign_id, business_id=business_id
            )

        conn.execute(
            """update research_runs set status = 'completed', completed_at = now(),
               stats = %s where id = %s""",
            (jsonb(stats), run_id),
        )
        conn.execute("update campaigns set last_run_at = now() where id = %s", (task.campaign_id,))
        log.info("discovery for campaign %s done: %s", task.campaign_id, stats)
    except Exception as exc:
        conn.execute(
            """update research_runs set status = 'failed', completed_at = now(),
               stats = %s, error = %s where id = %s""",
            (jsonb(stats), str(exc)[:2000], run_id),
        )
        raise


def _title_to_name(title: str) -> str:
    """Search result titles look like 'Acme Excavating | Duluth MN' — keep the name part."""
    for separator in (" | ", " – ", " - ", " — "):
        if separator in title:
            return title.split(separator)[0].strip()
    return title.strip()


def handle_process_csv_import(conn: psycopg.Connection, task: Task) -> None:
    job_id = task.payload.get("import_job_id")
    job = conn.execute("select * from import_jobs where id = %s", (job_id,)).fetchone()
    if job is None:
        raise RuntimeError(f"import job {job_id} not found")

    conn.execute("update import_jobs set status = 'processing' where id = %s", (job_id,))
    rows: list[dict] = job["rows"] or []
    existing = _load_existing(conn)
    imported = merged = skipped = 0
    errors: list[dict] = []
    campaign_id = str(job["campaign_id"]) if job["campaign_id"] else None

    for i, row in enumerate(rows):
        name = (row.get("company_name") or "").strip()
        if not name:
            skipped += 1
            errors.append({"row": i + 1, "error": "missing company_name"})
            continue
        try:
            candidate = Candidate(
                name=name,
                website_url=row.get("website") or None,
                phone=row.get("phone") or None,
                email=row.get("email") or None,
                city=row.get("city") or None,
                state=row.get("state") or None,
                industry=row.get("industry") or None,
                contact_name=row.get("contact_name") or None,
                source_type="csv_import",
                source_ref=f"{job_id}:{i + 1}",
                query=row.get("source") or job["filename"],
                raw=row,
            )
            result = upsert_candidate(conn, candidate, campaign_id, existing)
            if result is None:
                skipped += 1
            elif result.created:
                imported += 1
                if candidate.website_url:
                    queue.enqueue(
                        conn,
                        "research_website",
                        campaign_id=campaign_id,
                        business_id=result.business_id,
                    )
            else:
                merged += 1
        except Exception as exc:  # keep processing remaining rows
            errors.append({"row": i + 1, "error": str(exc)[:300]})
            skipped += 1

    conn.execute(
        """update import_jobs set status = 'completed', completed_at = now(),
           imported_count = %s, merged_count = %s, skipped_count = %s, errors = %s
           where id = %s""",
        (imported, merged, skipped, jsonb(errors), job_id),
    )
    log.info("csv import %s: %d imported, %d merged, %d skipped", job_id, imported, merged, skipped)
