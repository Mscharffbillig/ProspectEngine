"""Regression tests for identity coherence and malformed-name handling.

Live failures reproduced:
- Elcor Construction (third-party JSON-LD) replacing D & G Excavating
- "gerkeexcavat" (malformed JSON-LD) shown as a business name
"""

from pathlib import Path

from worker.crawler import FetchedPage, FixtureFetcher, crawl_site
from worker.identity import is_malformed_name, names_coherent, resolve_company_name

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def crawl(domain: str):
    return crawl_site(f"https://{domain}/", fetcher=FixtureFetcher(FIXTURES))


class TestIdentityCoherence:
    def test_third_party_json_ld_does_not_replace_owner(self):
        # Regression: Elcor Construction (a customer/partner in JSON-LD) must
        # not become the canonical name for dandgexcavating.com.
        pages = crawl("dandgexcavating.example.com")
        result = resolve_company_name(
            pages, "D & G Excavating", domain="dandgexcavating.example.com"
        )
        assert "Elcor" not in result.name
        assert "D & G Excavating" in result.name
        assert not result.conflict
        # The rejected candidate is still stored for audit.
        assert any("Elcor" in c.name for c in result.candidates)

    def test_incoherent_single_source_flags_conflict(self):
        # Only identity evidence is a third-party org with no domain overlap.
        pages = crawl("thirdpartyonly.example.com")
        result = resolve_company_name(
            pages,
            "Snow Removal and Lawn Care in St. Cloud",
            domain="thirdpartyonly.example.com",
        )
        assert "BrightWeb" not in result.name
        assert result.conflict
        assert result.confidence == "low"

    def test_two_agreeing_sources_can_beat_domain_mismatch(self):
        # A brand whose domain is initials: og + footer agree on the name.
        pages = [
            FetchedPage(
                url="https://asg-mn.example.com/",
                title="Acme Services Group",
                http_status=200,
                text="Acme Services Group provides facility maintenance.",
                content_hash="x",
                meta={
                    "og_site_name": "Acme Services Group",
                    "footer_text": "© 2026 Acme Services Group, Inc.",
                },
            )
        ]
        result = resolve_company_name(pages, "ASG", domain="asg-mn.example.com")
        assert "Acme Services Group" in result.name
        assert not result.conflict

    def test_names_coherent_handles_ampersand_and_initials(self):
        assert names_coherent("D & G Excavating", "dandgexcavating.example.com")
        assert names_coherent("Gerke Excavating", "gerkeexcavating.example.com")
        assert names_coherent("Acme Services Group", "asg-mn.example.com")
        assert not names_coherent("Elcor Construction", "dandgexcavating.example.com")
        assert not names_coherent("BrightWeb Design Studio", "thirdpartyonly.example.com")


class TestMalformedNames:
    def test_truncated_slug_rejected(self):
        for bad in ("gerkeexcavat", "minnesotaplumb", "twincitieslandscap"):
            assert is_malformed_name(bad), bad

    def test_hyphenated_lowercase_slug_rejected(self):
        for bad in ("albiero-plumbing", "d-and-g-excavating", "acme-hvac-services"):
            assert is_malformed_name(bad), bad

    def test_generic_and_cta_rejected(self):
        for bad in (
            "Commercial Excavation",
            "HVAC Company",
            "Home",
            "Contact Us",
            "403 Forbidden",
            "Page Not Found",
            "Learn More",
        ):
            assert is_malformed_name(bad), bad

    def test_real_names_accepted(self):
        for good in (
            "D & G Excavating, Inc.",
            "Genz-Ryan",
            "ATK",
            "Gerke Excavating",
            "Hoffman Cooling & Heating",
            "Standard Heating & Air Conditioning",
        ):
            assert not is_malformed_name(good), good

    def test_malformed_json_ld_falls_back_to_title(self):
        # Regression: "gerkeexcavat" must never be the resolved name.
        pages = crawl("gerkeexcavating.example.com")
        result = resolve_company_name(
            pages, "Gerke Excavating | Tomah WI", domain="gerkeexcavating.example.com"
        )
        assert result.name == "Gerke Excavating"
        assert result.name != "gerkeexcavat"

    def test_no_usable_evidence_keeps_cleaned_provisional(self):
        result = resolve_company_name(
            [], "Acme Grading | Hudson WI", domain="acmegrading.example.com"
        )
        assert result.name == "Acme Grading"
        assert result.confidence == "low"
