"""Qualification: hard validation gates, scoring, pain hypotheses, drafts."""

import logging

import psycopg

from worker import queue
from worker.db import jsonb
from worker.drafting import DraftInput, build_characteristic, render_draft
from worker.extraction import Fact
from worker.handlers.research import _load_pages
from worker.hypotheses import generate_hypotheses
from worker.identity import NameResolution
from worker.queue import Task
from worker.scoring import SCORING_VERSION, Rule, derive_signals, score
from worker.validation import validate_business

log = logging.getLogger(__name__)


def _load_facts(conn: psycopg.Connection, business_id: str | None) -> list[Fact]:
    rows = conn.execute(
        """select fact_key, value, confidence, source_url, excerpt, method
           from extracted_facts where business_id = %s""",
        (business_id,),
    ).fetchall()
    return [
        Fact(
            r["fact_key"],
            r["value"],
            r["confidence"],
            r["source_url"] or "",
            r["excerpt"] or "",
            r["method"],
        )
        for r in rows
    ]


def _signals_for_business(conn: psycopg.Connection, business_id: str | None):
    facts = _load_facts(conn, business_id)
    contacts = conn.execute(
        """select count(*) as total,
                  count(*) filter (where is_decision_maker) as dm
           from business_contacts where business_id = %s""",
        (business_id,),
    ).fetchone()
    page_count_row = conn.execute(
        "select count(*) as n from website_pages where business_id = %s",
        (business_id,),
    ).fetchone()
    assert contacts is not None and page_count_row is not None
    return derive_signals(
        facts,
        contact_count=contacts["total"],
        decision_maker_count=contacts["dm"],
        page_count=page_count_row["n"],
    )


def _run_validation(conn: psycopg.Connection, task: Task, facts: list[Fact]):
    business = conn.execute(
        "select name, name_confidence, name_source, state from businesses where id = %s",
        (task.business_id,),
    ).fetchone()
    assert business is not None

    industries: list[str] = []
    locations: list[str] = []
    if task.campaign_id:
        industries = [
            r["industry"]
            for r in conn.execute(
                "select industry from campaign_industries where campaign_id = %s",
                (task.campaign_id,),
            ).fetchall()
        ]
        locations = [
            r["location"]
            for r in conn.execute(
                "select location from campaign_locations where campaign_id = %s",
                (task.campaign_id,),
            ).fetchall()
        ]

    name_resolution = NameResolution(
        name=business["name"],
        confidence=business["name_confidence"] or "low",
        source=business["name_source"] or "search_title",
        source_url=None,
        evidence="",
    )
    pages = _load_pages(conn, task.business_id)
    result = validate_business(
        pages,
        facts,
        name_resolution,
        industries,
        locations,
        business_state=business["state"],
    )
    conn.execute(
        """update businesses set validation_status = %s, validation_reasons = %s,
           validation_checks = %s where id = %s""",
        (result.state, jsonb(result.reasons), jsonb(result.checks), task.business_id),
    )
    return result


def handle_score_business(conn: psycopg.Connection, task: Task) -> None:
    facts = _load_facts(conn, task.business_id)
    validation = _run_validation(conn, task, facts)

    rules = [
        Rule(
            rule_key=r["rule_key"],
            label=r["label"],
            points=r["points"],
            signal=(r["definition"] or {}).get("signal", r["rule_key"]),
            active=r["active"],
            min_confidence=(r["definition"] or {}).get("min_confidence", "medium"),
            category=(r["definition"] or {}).get("category", "fit"),
        )
        for r in conn.execute("select * from qualification_rules").fetchall()
    ]
    signals = _signals_for_business(conn, task.business_id)
    result = score(rules, signals)

    row = conn.execute(
        """insert into qualification_runs (business_id, total_score, scoring_version)
           values (%s, %s, %s) returning id""",
        (task.business_id, result.total, SCORING_VERSION),
    ).fetchone()
    assert row is not None
    run_id = row["id"]
    for applied in result.applied:
        conn.execute(
            """insert into qualification_evidence
                 (run_id, rule_key, label, points, evidence, source_url, confidence)
               values (%s, %s, %s, %s, %s, %s, %s)""",
            (
                run_id,
                applied.rule_key,
                applied.label,
                applied.points,
                applied.evidence,
                applied.source_url,
                applied.confidence,
            ),
        )

    min_score = 30
    if task.campaign_id:
        campaign = conn.execute(
            "select min_qualification_score from campaigns where id = %s", (task.campaign_id,)
        ).fetchone()
        if campaign:
            min_score = campaign["min_qualification_score"]

    # Hard gates first: a score can never qualify a business that failed them.
    if validation.state == "valid" and result.total >= min_score:
        status = "qualified"
    else:
        status = "needs_review"
    conn.execute(
        """update businesses set score = %s, status = %s
           where id = %s and status in
             ('unresearched', 'researching', 'qualified', 'needs_review')""",
        (result.total, status, task.business_id),
    )

    queue.enqueue(
        conn, "generate_hypotheses", campaign_id=task.campaign_id, business_id=task.business_id
    )
    log.info(
        "scored business %s: %d (%s, validation=%s%s), %d rules applied",
        task.business_id,
        result.total,
        status,
        validation.state,
        f" reasons={validation.reasons}" if validation.reasons else "",
        len(result.applied),
    )


def handle_generate_hypotheses(conn: psycopg.Connection, task: Task) -> None:
    conn.execute("delete from pain_hypotheses where business_id = %s", (task.business_id,))

    business = conn.execute(
        "select validation_status from businesses where id = %s", (task.business_id,)
    ).fetchone()
    if business is None or business["validation_status"] != "valid":
        log.info(
            "skipping hypotheses for business %s (validation=%s)",
            task.business_id,
            business["validation_status"] if business else "missing",
        )
        return

    signals = _signals_for_business(conn, task.business_id)
    hypotheses = generate_hypotheses(signals)
    for h in hypotheses:
        conn.execute(
            """insert into pain_hypotheses (business_id, question, signal_key, evidence, source_url)
               values (%s, %s, %s, %s, %s)""",
            (task.business_id, h.question, h.signal_key, h.evidence, h.source_url),
        )
    log.info("generated %d hypotheses for business %s", len(hypotheses), task.business_id)


def handle_generate_outreach_draft(conn: psycopg.Connection, task: Task) -> None:
    business = conn.execute(
        "select * from businesses where id = %s", (task.business_id,)
    ).fetchone()
    if business is None:
        raise RuntimeError(f"business {task.business_id} not found")

    # Personalized greeting only for a validated decision-maker; otherwise the
    # draft stays generic rather than guessing at a name.
    contact = conn.execute(
        """select * from business_contacts
           where business_id = %s and name is not null and is_decision_maker
           order by created_at asc limit 1""",
        (task.business_id,),
    ).fetchone()

    hypothesis = conn.execute(
        """select question from pain_hypotheses where business_id = %s
           order by created_at asc limit 1""",
        (task.business_id,),
    ).fetchone()

    signals = _signals_for_business(conn, task.business_id)
    location = ", ".join(x for x in [business["city"], business["state"]] if x) or (
        business["state"] or None
    )

    subject, body = render_draft(
        DraftInput(
            company_name=business["name"],
            industry=business["industry"],
            location=location,
            contact_first_name=contact["name"].split()[0] if contact else None,
            characteristic=build_characteristic(dict.fromkeys(signals.keys(), "")),
            workflow_question=hypothesis["question"] if hypothesis else None,
        )
    )

    conn.execute(
        """insert into outreach_drafts (business_id, contact_id, subject, body, method)
           values (%s, %s, %s, %s, 'template')""",
        (task.business_id, contact["id"] if contact else None, subject, body),
    )
    log.info("created outreach draft for business %s", task.business_id)
