"""Shared candidate upsert: normalize, dedupe against existing businesses,
merge sources without deleting evidence."""

import logging
from dataclasses import dataclass
from typing import Any

import psycopg

from worker.db import jsonb
from worker.dedupe import CandidateRecord, find_duplicate
from worker.normalize import (
    normalize_city,
    normalize_company_name,
    normalize_domain,
    normalize_phone,
    normalize_state,
    normalize_url,
)

log = logging.getLogger(__name__)


@dataclass
class Candidate:
    name: str
    website_url: str | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    state: str | None = None
    address: str | None = None
    industry: str | None = None
    contact_name: str | None = None
    name_confidence: str = "medium"  # csv imports carry real names; search titles are "low"
    name_source: str = "import"
    # source record fields
    source_type: str = "search_api"
    source_ref: str | None = None
    query: str | None = None
    title: str | None = None
    url: str | None = None
    snippet: str | None = None
    rank: int | None = None
    raw: dict[str, Any] | None = None


@dataclass
class UpsertResult:
    business_id: str
    created: bool  # False => merged into an existing business


def _load_existing(conn: psycopg.Connection) -> list[CandidateRecord]:
    rows = conn.execute(
        """select id, name, domain, normalized_phone, city, address from businesses"""
    ).fetchall()
    return [
        CandidateRecord(
            id=str(r["id"]),
            name=r["name"] or "",
            domain=r["domain"],
            phone=r["normalized_phone"],
            city=r["city"],
            address=r["address"],
        )
        for r in rows
    ]


def is_suppressed(conn: psycopg.Connection, domain: str | None, name: str) -> bool:
    row = conn.execute(
        """select 1 from suppression_list
           where (domain is not null and lower(domain) = lower(coalesce(%s, '')))
              or (company_name is not null and lower(company_name) = lower(%s))
           limit 1""",
        (domain, name),
    ).fetchone()
    return row is not None


def upsert_candidate(
    conn: psycopg.Connection,
    candidate: Candidate,
    campaign_id: str | None,
    existing: list[CandidateRecord],
) -> UpsertResult | None:
    """Insert a new business or merge the source into an existing duplicate.

    `existing` is mutated so subsequent candidates in the same run dedupe
    against businesses created earlier in the run.
    """
    domain = normalize_domain(candidate.website_url) if candidate.website_url else None
    phone = normalize_phone(candidate.phone) if candidate.phone else None

    if is_suppressed(conn, domain, candidate.name):
        log.info("skipping suppressed candidate %r", candidate.name)
        return None

    record = CandidateRecord(
        name=candidate.name,
        domain=domain,
        phone=phone,
        city=candidate.city,
        address=candidate.address,
    )
    duplicate = find_duplicate(record, existing)

    if duplicate is not None:
        business_id = duplicate[0].id
        assert business_id is not None
        created = False
        log.info(
            "merging %r into existing business %s (signals: %s)",
            candidate.name,
            business_id,
            duplicate[1].signals,
        )
    else:
        row = conn.execute(
            """insert into businesses
                 (campaign_id, name, normalized_name, website_url, domain,
                  phone, normalized_phone, email, address, city, state, industry,
                  name_confidence, name_source)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               returning id""",
            (
                campaign_id,
                candidate.name,
                normalize_company_name(candidate.name),
                normalize_url(candidate.website_url) if candidate.website_url else None,
                domain,
                candidate.phone,
                phone,
                candidate.email,
                candidate.address,
                normalize_city(candidate.city) if candidate.city else None,
                normalize_state(candidate.state) if candidate.state else None,
                candidate.industry,
                candidate.name_confidence,
                candidate.name_source,
            ),
        ).fetchone()
        assert row is not None
        business_id = str(row["id"])
        created = True
        record.id = business_id
        existing.append(record)

    conn.execute(
        """insert into business_sources
             (business_id, source_type, source_ref, query, title, url, snippet, rank, raw)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            business_id,
            candidate.source_type,
            candidate.source_ref,
            candidate.query,
            candidate.title,
            candidate.url,
            candidate.snippet,
            candidate.rank,
            jsonb(candidate.raw) if candidate.raw else None,
        ),
    )

    if candidate.contact_name:
        conn.execute(
            """insert into business_contacts
                 (business_id, name, email, email_source, email_confidence, method, name_confidence)
               values (%s, %s, %s, %s, %s, 'manual', 'medium')""",
            (
                business_id,
                candidate.contact_name,
                candidate.email,
                "generic_business" if candidate.email else None,
                "medium" if candidate.email else None,
            ),
        )

    return UpsertResult(business_id=business_id, created=created)
