"""Focused tests for Phase 2A enrichment. Providers are mocked — no live Brave,
Hunter, or Anthropic calls."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from worker import config, providers
from worker.adapters.search import SearchResult
from worker.crawler import FetchedPage
from worker.enrichment import (
    MAX_BRAVE_QUERIES,
    ExternalCandidate,
    assess_contact_readiness,
    build_queries,
    classify_email_type,
    classify_person,
    is_verified_decision_maker,
    sanitize_ai_analysis,
    should_skip_enrichment,
)
from worker.handlers import HANDLERS
from worker.handlers import enrich as enrich_mod
from worker.handlers.enrich import (
    _stage_ai,
    _stage_hunter,
    _stage_public_research,
    is_enrichable,
)

# ── fake DB connection ───────────────────────────────────────────────


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


class FakeConn:
    def __init__(self, responder):
        self._responder = responder
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params or ()))
        return FakeCursor(self._responder(sql, params or ()))

    def count(self, needle):
        return sum(1 for sql, _ in self.executed if needle in sql)


def responder_factory(manual_emails=None):
    def responder(sql, params):
        if "insert into enrichment_runs" in sql and "returning id" in sql:
            return [{"id": "run-1"}]
        if "and email is not null" in sql:
            return [{"email": e} for e in (manual_emails or [])]
        return []

    return responder


BUSINESS = {
    "id": "biz-1",
    "name": "Acme Excavating",
    "domain": "acmeexcavating.com",
    "city": "Duluth",
    "state": "MN",
    "industry": "Excavation",
    "email": None,
    "phone": None,
    "website_url": "https://acmeexcavating.com",
    "status": "qualified",
    "validation_status": "valid",
    "validation_overridden": False,
    "campaign_id": None,
}


# ── eligibility ──────────────────────────────────────────────────────


def test_registered_and_handler_registered():
    assert "enrich_lead" in HANDLERS


@pytest.mark.parametrize(
    "status,vs,overridden,suppressed,expected",
    [
        ("qualified", "valid", False, False, True),
        ("needs_review", "manual_review_required", False, False, True),
        ("needs_review", "invalid", True, False, True),  # overridden
        ("rejected", "valid", False, False, False),
        ("do_not_contact", "valid", False, False, False),
        ("needs_review", "invalid", False, False, False),  # invalid, no override
        ("qualified", "valid", False, True, False),  # suppressed
    ],
)
def test_is_enrichable(status, vs, overridden, suppressed, expected):
    assert is_enrichable(status, vs, overridden, suppressed) is expected


# ── query building ───────────────────────────────────────────────────


def test_build_queries_capped_at_four():
    qs = build_queries("Acme Excavating", "acmeexcavating.com", "Duluth", "MN", "Excavation")
    assert 1 <= len(qs) <= MAX_BRAVE_QUERIES
    assert all("Acme Excavating" in q for q in qs)


# ── person classification ────────────────────────────────────────────


def test_registered_agent_not_owner():
    role_type, _ = classify_person("John Smith", "Registered Agent: John Smith")
    assert role_type == "registered_agent"


@pytest.mark.parametrize(
    "context",
    [
        "John Smith, attorney at law",
        "site designed by John Smith",
        "John Smith, a happy customer, left a testimonial",
        "John Smith, our accountant (CPA)",
        "former owner John Smith",
    ],
)
def test_disqualifying_context_never_owner(context):
    role_type, verification = classify_person("John Smith", context)
    assert role_type != "owner"


def test_genuine_owner_is_likely():
    role_type, verification = classify_person("Jane Doe", "Jane Doe, Owner and President")
    assert role_type == "owner"
    assert verification == "likely"


def test_unverified_person_not_used_in_outreach():
    cand = ExternalCandidate(
        name="Jane Doe",
        role="Owner",
        role_type="owner",
        company_association="Acme",
        source="brave",
        method="search_snippet",
        verification_state="likely",
    )
    assert is_verified_decision_maker(cand) is False
    cand.verification_state = "confirmed"
    assert is_verified_decision_maker(cand) is True


# ── email typing ─────────────────────────────────────────────────────


def test_pattern_email_never_confirmed():
    assert classify_email_type("guess@acme.com", provider_pattern=True) == "pattern_unverified"
    assert classify_email_type("info@acme.com") == "generic"
    assert classify_email_type("jane@acme.com", website_published=True) == "website_published"


# ── contact readiness (independent of fit score) ─────────────────────


def test_contact_readiness_separate_from_score():
    import inspect

    assert "score" not in inspect.signature(assess_contact_readiness).parameters
    assert (
        assess_contact_readiness(
            do_not_contact=False,
            has_verified_direct_contact=True,
            has_general_channel=False,
            has_uncertain_candidate=False,
        )
        == "ready_direct"
    )
    assert (
        assess_contact_readiness(
            do_not_contact=False,
            has_verified_direct_contact=False,
            has_general_channel=True,
            has_uncertain_candidate=False,
        )
        == "ready_general"
    )
    assert (
        assess_contact_readiness(
            do_not_contact=False,
            has_verified_direct_contact=False,
            has_general_channel=False,
            has_uncertain_candidate=False,
        )
        == "needs_contact_enrichment"
    )
    assert (
        assess_contact_readiness(
            do_not_contact=True,
            has_verified_direct_contact=True,
            has_general_channel=True,
            has_uncertain_candidate=True,
        )
        == "not_contactable"
    )


# ── cache / force ────────────────────────────────────────────────────


def test_cache_prevents_rerun_and_force_bypasses():
    now = datetime(2026, 7, 19, tzinfo=UTC)
    recent = now - timedelta(days=5)
    old = now - timedelta(days=40)
    assert should_skip_enrichment(recent, now, force=False, cache_days=30) is True
    assert should_skip_enrichment(recent, now, force=True, cache_days=30) is False
    assert should_skip_enrichment(old, now, force=False, cache_days=30) is False
    assert should_skip_enrichment(None, now, force=False, cache_days=30) is False


# ── AI output contract ───────────────────────────────────────────────


def test_ai_requires_evidence_references():
    raw = {
        "business_summary": "Regional excavator.",
        "strongest_operational_signals": [
            {"statement": "Runs multiple crews", "evidence_ids": ["Q1"]},
            {"statement": "Made-up claim", "evidence_ids": []},  # no refs -> dropped
            {"statement": "Bad ref", "evidence_ids": ["Z9"]},  # unknown -> dropped
        ],
        "possible_workflow_problems": [
            {"hypothesis": "Scheduling across crews is manual", "evidence_ids": ["Q1", "E2"]},
        ],
        "discovery_questions": ["How do you schedule crews?"],
        "overall_confidence": "medium",
    }
    out = sanitize_ai_analysis(raw, {"Q1", "E2"})
    signals = out["strongest_operational_signals"]
    assert len(signals) == 1
    assert signals[0]["text"] == "Runs multiple crews"
    assert out["possible_workflow_problems"][0]["is_hypothesis"] is True
    assert out["discovery_questions"] == ["How do you schedule crews?"]


def test_ai_weak_evidence_yields_empty_claims():
    out = sanitize_ai_analysis(
        {"strongest_operational_signals": [{"statement": "x", "evidence_ids": ["Q1"]}]},
        set(),
    )
    assert out["strongest_operational_signals"] == []


def test_sanitize_handles_non_dict():
    assert sanitize_ai_analysis("nonsense", {"Q1"}) == {}


# ── missing provider keys fail gracefully ────────────────────────────


def test_hunter_unconfigured(monkeypatch):
    monkeypatch.setattr(config.settings, "hunter_api_key", "")
    res = providers.hunter_domain_search("acme.com")
    assert res.configured is False and res.success is False


def test_ai_unconfigured(monkeypatch):
    monkeypatch.setattr(config.settings, "ai_provider", "")
    monkeypatch.setattr(config.settings, "anthropic_api_key", "")
    res = providers.ai_opportunity_brief({})
    assert res.configured is False and res.success is False


# ── stage limits (mocked adapters/providers) ─────────────────────────


class CountingAdapter:
    def __init__(self):
        self.calls = 0

    def search(self, query, count=20):
        self.calls += 1
        return [
            SearchResult(
                query=query,
                title=f"r{i}",
                url=f"https://site{self.calls}-{i}.com/",
                snippet="",
                rank=i,
            )
            for i in range(8)
        ]


class CountingFetcher:
    def __init__(self):
        self.calls = 0

    def fetch(self, url):
        self.calls += 1
        return FetchedPage(url=url, title=None, http_status=200, text="", content_hash="")

    def close(self):
        pass


def test_brave_and_page_limits(monkeypatch):
    adapter = CountingAdapter()
    fetcher = CountingFetcher()
    monkeypatch.setattr(enrich_mod, "make_search_adapter", lambda: adapter)
    monkeypatch.setattr(enrich_mod, "make_fetcher", lambda: fetcher)
    conn = FakeConn(responder_factory())
    stage, _ = _stage_public_research(conn, "run-1", BUSINESS)
    assert stage["status"] == "ok"
    assert adapter.calls <= MAX_BRAVE_QUERIES
    assert fetcher.calls <= 6


def test_hunter_one_request_and_manual_not_overwritten(monkeypatch):
    calls = {"n": 0}

    def fake_hunter(domain, **kw):
        calls["n"] += 1
        return providers.ProviderResult(
            provider="hunter",
            operation="domain_search",
            configured=True,
            success=True,
            request_count=1,
            data={
                "emails": [
                    {
                        "value": "jane@acme.com",
                        "first_name": "Jane",
                        "last_name": "Doe",
                        "position": "Owner",
                        "confidence": 95,
                        "type": "personal",
                    },
                    {
                        "value": "bob@acme.com",
                        "first_name": "Bob",
                        "last_name": "Roe",
                        "position": "Manager",
                        "confidence": 80,
                        "type": "personal",
                    },
                ]
            },
        )

    monkeypatch.setattr(providers, "hunter_domain_search", fake_hunter)
    conn = FakeConn(responder_factory(manual_emails=["jane@acme.com"]))
    stage, cands = _stage_hunter(conn, "run-1", BUSINESS)
    assert calls["n"] == 1  # exactly one Hunter request
    emails = {c.email for c in cands}
    assert "jane@acme.com" not in emails  # manual contact preserved
    assert "bob@acme.com" in emails
    assert all(c.verification_state != "confirmed" for c in cands)


def test_ai_one_request(monkeypatch):
    calls = {"n": 0}

    def fake_ai(payload, **kw):
        calls["n"] += 1
        return providers.ProviderResult(
            provider="anthropic",
            operation="opportunity_brief",
            configured=True,
            success=True,
            request_count=1,
            data={"raw_json": {"business_summary": "ok", "overall_confidence": "low"}},
        )

    monkeypatch.setattr(providers, "ai_opportunity_brief", fake_ai)
    conn = FakeConn(responder_factory())
    stage, analysis = _stage_ai(conn, "run-1", BUSINESS, [])
    assert calls["n"] == 1
    assert stage["status"] == "ok"
    assert analysis["business_summary"] == "ok"


def test_provider_error_isolated_to_its_stage(monkeypatch):
    def failing_hunter(domain, **kw):
        return providers.ProviderResult(
            provider="hunter",
            operation="domain_search",
            configured=True,
            success=False,
            request_count=1,
            error="rate limited (429)",
        )

    monkeypatch.setattr(providers, "hunter_domain_search", failing_hunter)
    conn = FakeConn(responder_factory())
    stage, cands = _stage_hunter(conn, "run-1", BUSINESS)
    assert stage["status"] == "error"
    assert cands == []  # failure does not raise; other stages can still run


def test_safe_source_links_in_component():
    tsx = (
        Path(__file__).resolve().parents[3] / "apps/web/src/components/enrichment-section.tsx"
    ).read_text(encoding="utf-8")
    assert 'target="_blank"' in tsx
    assert 'rel="noopener noreferrer"' in tsx
