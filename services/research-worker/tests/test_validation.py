from worker.crawler import FetchedPage
from worker.extraction import Fact
from worker.identity import NameResolution
from worker.validation import validate_business

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
