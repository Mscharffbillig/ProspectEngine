"""Integration tests using saved HTML fixtures (no live websites)."""

from pathlib import Path

from worker.crawler import FixtureFetcher, crawl_site
from worker.extraction import dedupe_facts, extract_from_page

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def crawl_fixture(domain: str):
    fetcher = FixtureFetcher(FIXTURES)
    return crawl_site(f"https://{domain}/", fetcher=fetcher)


def facts_for(domain: str):
    pages = crawl_fixture(domain)
    facts = []
    for page in pages:
        facts.extend(extract_from_page(page.url, page.text))
    return dedupe_facts(facts)


def keys(facts) -> set[str]:
    return {f.key for f in facts}


class TestCrawler:
    def test_crawls_priority_pages(self):
        pages = crawl_fixture("northstarexcavating.example.com")
        assert 1 < len(pages) <= 7
        urls = {p.url for p in pages}
        assert any("about" in u for u in urls)
        assert any("contact" in u for u in urls)

    def test_pages_have_title_text_hash(self):
        pages = crawl_fixture("northstarexcavating.example.com")
        home = pages[0]
        assert home.title and "Northstar" in home.title
        assert "excavation" in home.text.lower()
        assert home.content_hash

    def test_missing_site_yields_no_pages(self):
        assert crawl_fixture("nosuchsite.example.com") == []


class TestNorthstarExtraction:
    """Strong-fit fixture: crews, commercial, equipment, owner, hiring."""

    def test_contact_facts_confirmed(self):
        facts = facts_for("northstarexcavating.example.com")
        phone = next(f for f in facts if f.key == "phone")
        assert phone.value == "(218) 555-0142"
        assert phone.confidence == "confirmed"
        assert phone.source_url
        assert phone.excerpt
        emails = [f.value for f in facts if f.key == "email"]
        assert "info@northstarexcavating.example.com" in emails

    def test_owner_and_ops_manager_found(self):
        facts = facts_for("northstarexcavating.example.com")
        people = [f.value for f in facts if f.key == "person_role"]
        assert any(p == "Dale Hendrickson|owner" for p in people)
        assert any(p == "Erik Hendrickson|operations manager" for p in people)

    def test_business_signals(self):
        found = keys(facts_for("northstarexcavating.example.com"))
        for expected in (
            "multiple_crews",
            "commercial_work",
            "equipment_heavy",
            "hiring",
            "independent_signal",
            "service_area",
            "established_year",
            "quote_driven",
        ):
            assert expected in found, expected

    def test_every_fact_has_evidence(self):
        for fact in facts_for("northstarexcavating.example.com"):
            assert fact.source_url, fact.key
            assert fact.excerpt, fact.key
            assert fact.confidence in ("confirmed", "high", "medium", "low", "unknown")


class TestNegativeFixtures:
    def test_franchise_detected(self):
        found = keys(facts_for("cleansweepfranchise.example.com"))
        assert "franchise_signal" in found
        assert "software_named" in found

    def test_solo_operator_detected(self):
        found = keys(facts_for("reliableplumbing.example.com"))
        assert "solo_operator_signal" in found
        assert "multiple_crews" not in found
