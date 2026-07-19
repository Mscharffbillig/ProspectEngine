"""Regression tests for the data-quality failures observed in the first live run.

Fixtures reproduce the failure modes without copying real site content:
- fahrnerexcavating: SEO title + JSON-LD identity + every observed false-person trap
- standardheating: SEO title + og:site_name identity
- mattisoncontractors: service-page title + header logo alt + footer legal name
"""

from pathlib import Path

import pytest

from worker.crawler import FixtureFetcher, crawl_site
from worker.identity import resolve_company_name
from worker.people import extract_people

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"

FALSE_PERSON_PHRASES = [
    "customer reviews home",
    "job type",
    "our team meet",
    "insured home",
    "shop mechanics equipment",
]


def crawl(domain: str):
    return crawl_site(f"https://{domain}/", fetcher=FixtureFetcher(FIXTURES))


@pytest.fixture(scope="module")
def fahrner_pages():
    return crawl("fahrnerexcavating.example.com")


class TestFalsePersonRegression:
    def test_observed_false_persons_are_rejected(self, fahrner_pages):
        people = extract_people(fahrner_pages)
        names = [p.name.lower().replace("\n", " ") for p in people]
        for phrase in FALSE_PERSON_PHRASES:
            assert not any(phrase in n for n in names), f"{phrase!r} extracted as a person"
        # Broader guard: no navigation/heading words survive as name tokens.
        for name in names:
            for word in ("reviews", "home", "team", "type", "shop", "equipment", "insured"):
                assert word not in name.split(), f"suspicious token in person name {name!r}"

    def test_real_team_members_still_found(self, fahrner_pages):
        people = extract_people(fahrner_pages)
        by_name = {p.name: p for p in people}
        assert "Randy Fahrner" in by_name
        assert by_name["Randy Fahrner"].role_type == "owner"
        assert by_name["Randy Fahrner"].confidence in ("confirmed", "high")
        assert "Lisa Trzebiatowski" in by_name
        assert by_name["Lisa Trzebiatowski"].role_type == "office_manager"

    def test_every_person_has_evidence(self, fahrner_pages):
        for person in extract_people(fahrner_pages):
            assert person.source_url
            assert person.excerpt
            assert person.method in ("json_ld", "dom_team", "text_pattern")

    def test_strict_text_pattern_still_works(self):
        # Northstar uses plain-text "Dale Hendrickson, Owner" style attribution.
        pages = crawl("northstarexcavating.example.com")
        people = extract_people(pages)
        names = {p.name for p in people}
        assert "Dale Hendrickson" in names
        assert "Erik Hendrickson" in names


class TestCanonicalNameRegression:
    def test_json_ld_beats_seo_title(self):
        pages = crawl("fahrnerexcavating.example.com")
        result = resolve_company_name(pages, "Plover's Top-Rated Excavation Contractor")
        assert result.name == "Fahrner Excavating, Inc."
        assert result.confidence == "confirmed"
        assert result.source == "json_ld"

    def test_og_site_name_beats_seo_title(self):
        pages = crawl("standardheating.example.com")
        result = resolve_company_name(pages, "HVAC Company In Minneapolis, MN")
        assert result.name == "Standard Heating & Air Conditioning"
        assert result.confidence == "high"
        assert result.source == "og_site_name"

    def test_brand_or_footer_beats_service_title(self):
        pages = crawl("mattisoncontractors.example.com")
        result = resolve_company_name(pages, "Commercial Excavation")
        assert "Mattison Contractors" in result.name
        assert result.confidence in ("confirmed", "high", "medium")
        assert result.source in ("header_brand", "logo_alt", "footer_legal")

    def test_search_title_is_last_resort_and_low_confidence(self):
        result = resolve_company_name([], "Acme Excavating | Duluth MN")
        assert result.name == "Acme Excavating"
        assert result.confidence == "low"
        assert result.source == "search_title"

    def test_error_page_title_never_becomes_name(self):
        from worker.crawler import FetchedPage

        error_page = FetchedPage(
            url="https://blocked.example.com/",
            title="403 Forbidden",
            http_status=403,
            text="403 Forbidden",
            content_hash="x",
        )
        result = resolve_company_name([error_page], "Acme Grading | Hudson WI")
        assert result.name == "Acme Grading"
        assert result.source == "search_title"
        assert result.confidence == "low"

    def test_demo_fixture_unaffected(self):
        pages = crawl("northstarexcavating.example.com")
        result = resolve_company_name(pages, "Northstar Excavating | Duluth MN")
        assert "Northstar Excavating" in result.name
