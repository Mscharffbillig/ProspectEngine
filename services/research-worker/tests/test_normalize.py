from worker.normalize import (
    normalize_address,
    normalize_city,
    normalize_company_name,
    normalize_domain,
    normalize_phone,
    normalize_state,
    normalize_url,
)


class TestCompanyName:
    def test_strips_llc(self):
        assert normalize_company_name("Acme Excavating, LLC") == "acme excavating"

    def test_strips_inc(self):
        assert normalize_company_name("Northland HVAC Inc.") == "northland hvac"

    def test_strips_incorporated(self):
        assert normalize_company_name("Riverside Plumbing Incorporated") == "riverside plumbing"

    def test_strips_company(self):
        assert normalize_company_name("Miller Landscaping Company") == "miller landscaping"

    def test_strips_co(self):
        assert normalize_company_name("Anderson Restoration Co.") == "anderson restoration"

    def test_strips_corporation(self):
        assert normalize_company_name("Superior Cleaning Corporation") == "superior cleaning"

    def test_strips_corp(self):
        assert normalize_company_name("Duluth Machining Corp") == "duluth machining"

    def test_strips_stacked_suffixes(self):
        assert normalize_company_name("Twin Cities Repair Co Inc") == "twin cities repair"

    def test_keeps_suffix_word_inside_name(self):
        # "Co" as an interior word must survive.
        assert normalize_company_name("Co-op Excavating LLC") == "co op excavating"

    def test_punctuation_and_case(self):
        assert normalize_company_name("  J&J  SEPTIC,   L.L.C. ") == "j&j septic"


class TestDomainAndUrl:
    def test_strips_www_and_path(self):
        assert normalize_domain("https://www.Acme-Excavating.com/about") == "acme-excavating.com"

    def test_bare_domain(self):
        assert normalize_domain("acme.com") == "acme.com"

    def test_invalid(self):
        assert normalize_domain("not a url") is None

    def test_url_adds_scheme_and_strips_trailing_slash(self):
        assert normalize_url("acme.com/services/") == "https://acme.com/services"

    def test_url_lowercases_host_only(self):
        assert normalize_url("HTTPS://ACME.COM/About") == "https://acme.com/About"


class TestPhone:
    def test_formats(self):
        assert normalize_phone("(218) 555-0142") == "2185550142"
        assert normalize_phone("218.555.0142") == "2185550142"
        assert normalize_phone("+1 218-555-0142") == "2185550142"

    def test_rejects_short(self):
        assert normalize_phone("555-0142") is None


class TestLocation:
    def test_city(self):
        assert normalize_city("  duluth ") == "Duluth"

    def test_state_full_name(self):
        assert normalize_state("Minnesota") == "MN"
        assert normalize_state("wisconsin") == "WI"

    def test_state_code_passthrough(self):
        assert normalize_state("mn") == "MN"

    def test_address(self):
        assert normalize_address("123  Main St.,") == "123 main st"
