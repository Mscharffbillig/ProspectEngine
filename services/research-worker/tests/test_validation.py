from worker.crawler import FetchedPage
from worker.extraction import Fact
from worker.identity import NameResolution
from worker.scoring import SignalEvidence
from worker.validation import complexity_evidence, should_qualify, validate_business

INDUSTRIES = ["Excavation", "HVAC"]
LOCATIONS = ["Minnesota", "Western Wisconsin"]


def page(text: str, url: str = "https://acme.example.com/") -> FetchedPage:
    return FetchedPage(url=url, title="Acme", http_status=200, text=text, content_hash="x")


def contact_fact() -> Fact:
    return Fact("phone", "(218) 555-0142", "confirmed", "https://acme.example.com/", "call us")


def good_name() -> NameResolution:
    return NameResolution("Acme Excavating", "high", "og_site_name", None, "")


GOOD_TEXT = (
    "Acme Excavating provides excavation, grading, and site prep across Minnesota. "
    "Our crews serve Duluth and the surrounding area. Call us today for an estimate. "
) * 5


class TestHardGates:
    def test_valid_business_passes(self):
        result = validate_business(
            [page(GOOD_TEXT)], [contact_fact()], good_name(), INDUSTRIES, LOCATIONS
        )
        assert result.state == "valid"
        assert result.reasons == []
        assert all(c["passed"] for c in result.checks.values())

    def test_no_pages_is_crawl_failed(self):
        result = validate_business([], [], good_name(), INDUSTRIES, LOCATIONS)
        assert result.state == "invalid"
        assert "crawl_failed" in result.reasons

    def test_thin_content_fails(self):
        result = validate_business(
            [page("excavation MN")], [contact_fact()], good_name(), INDUSTRIES, LOCATIONS
        )
        assert result.state == "invalid"
        assert "no_meaningful_content" in result.reasons

    def test_wrong_industry(self):
        text = "We build custom software and websites for clients in Minnesota. " * 10
        result = validate_business(
            [page(text)], [contact_fact()], good_name(), INDUSTRIES, LOCATIONS
        )
        assert result.state == "invalid"
        assert "wrong_industry" in result.reasons

    def test_wrong_geography(self):
        text = "Excavation and grading services across Texas and Oklahoma. " * 10
        result = validate_business(
            [page(text)], [contact_fact()], good_name(), INDUSTRIES, LOCATIONS
        )
        assert result.state == "invalid"
        assert "wrong_geography" in result.reasons

    def test_geography_via_extracted_state(self):
        text = "Excavation and grading for local homeowners and builders. " * 10
        result = validate_business(
            [page(text)],
            [contact_fact()],
            good_name(),
            INDUSTRIES,
            LOCATIONS,
            business_state="MN",
        )
        assert "wrong_geography" not in result.reasons

    def test_directory_language_rejected(self):
        text = GOOD_TEXT + " Find the best contractors near you in our directory."
        result = validate_business(
            [page(text)], [contact_fact()], good_name(), INDUSTRIES, LOCATIONS
        )
        assert result.state == "invalid"
        assert "directory_or_aggregator" in result.reasons

    def test_article_language_rejected(self):
        text = GOOD_TEXT + " Posted on July 3 by our editors. Leave a comment below."
        result = validate_business(
            [page(text)], [contact_fact()], good_name(), INDUSTRIES, LOCATIONS
        )
        assert "article_or_blog" in result.reasons

    def test_no_contact_info_is_not_a_business(self):
        result = validate_business([page(GOOD_TEXT)], [], good_name(), INDUSTRIES, LOCATIONS)
        assert "not_a_business" in result.reasons

    def test_low_identity_confidence_needs_manual_review(self):
        weak = NameResolution("Commercial Excavation", "low", "search_title", None, "")
        result = validate_business([page(GOOD_TEXT)], [contact_fact()], weak, INDUSTRIES, LOCATIONS)
        assert result.state == "manual_review_required"
        assert "identity_unconfirmed" in result.reasons

    def test_identity_conflict_blocks_qualification(self):
        conflicted = NameResolution(
            "Snow Removal in St. Cloud",
            "low",
            "search_title",
            None,
            "",
            conflict=True,
            conflict_detail="json_ld names 'BrightWeb Design Studio'",
        )
        result = validate_business(
            [page(GOOD_TEXT)], [contact_fact()], conflicted, INDUSTRIES, LOCATIONS
        )
        assert result.state == "manual_review_required"
        assert "identity_conflict" in result.reasons
        assert "CONFLICT" in result.checks["identity"]["detail"]

    def test_franchise_is_hard_gated(self):
        facts = [
            contact_fact(),
            Fact(
                "franchise_signal",
                "franchise/national language",
                "high",
                "https://acme.example.com/",
                "300 franchise locations nationwide",
            ),
        ]
        result = validate_business([page(GOOD_TEXT)], facts, good_name(), INDUSTRIES, LOCATIONS)
        assert result.state == "invalid"
        assert "franchise_or_national_company" in result.reasons


class TestComplexityRequirement:
    def test_contactability_alone_is_not_complexity(self):
        signals = {
            "public_contact": SignalEvidence("(218) 555-0142", None, "confirmed"),
            "independent_business": SignalEvidence("family-owned", None, "high"),
            "quote_driven": SignalEvidence("free estimates", None, "medium"),
        }
        assert complexity_evidence(signals) is None

    def test_high_confidence_crews_is_complexity(self):
        signals = {"multiple_crews": SignalEvidence("three crews", None, "high")}
        found = complexity_evidence(signals)
        assert found is not None
        assert found[0] == "multiple_crews"

    def test_medium_confidence_does_not_count(self):
        signals = {"multiple_crews": SignalEvidence("our crews", None, "medium")}
        assert complexity_evidence(signals) is None

    def test_named_ops_manager_is_complexity(self):
        found = complexity_evidence({}, ops_manager_count=1)
        assert found is not None
        assert found[0] == "named_operations_role"

    def test_eligibility_and_score_without_complexity_not_qualified(self):
        # Regression: existence + contactability must not qualify a lead.
        assert not should_qualify("valid", score=45, min_score=30, has_complexity=False)
        assert should_qualify("valid", score=45, min_score=30, has_complexity=True)
        assert not should_qualify("invalid", score=90, min_score=30, has_complexity=True)
        assert not should_qualify("manual_review_required", 90, 30, True)

    def test_missing_complexity_is_a_warning_not_invalid(self):
        result = validate_business(
            [page(GOOD_TEXT)],
            [contact_fact()],
            good_name(),
            INDUSTRIES,
            LOCATIONS,
            signals={"public_contact": SignalEvidence("phone", None, "confirmed")},
        )
        assert result.state == "valid"
        assert "insufficient_complexity_evidence" in result.reasons
        assert result.checks["complexity"]["passed"] is False
