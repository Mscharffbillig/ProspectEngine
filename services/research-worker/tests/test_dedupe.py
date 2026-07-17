from worker.dedupe import CandidateRecord, find_duplicate, match


def rec(**kwargs) -> CandidateRecord:
    return CandidateRecord(**kwargs)


class TestSingleStrongSignals:
    def test_domain_match_is_duplicate(self):
        result = match(
            rec(name="Acme Excavating", domain="acme.com"),
            rec(name="Totally Different Name", domain="acme.com"),
        )
        assert result.is_duplicate
        assert "domain_exact" in result.signals

    def test_phone_match_is_duplicate(self):
        result = match(
            rec(name="Acme", phone="2185550142"),
            rec(name="Acme Excavating LLC", phone="2185550142"),
        )
        assert result.is_duplicate
        assert "phone_exact" in result.signals

    def test_name_and_city_is_duplicate(self):
        result = match(
            rec(name="Acme Excavating LLC", city="Duluth"),
            rec(name="Acme Excavating", city="duluth"),
        )
        assert result.is_duplicate
        assert "name_city_strong" in result.signals

    def test_address_match_is_duplicate(self):
        result = match(rec(name="A", address="123 Main St"), rec(name="B", address="123  Main St."))
        assert result.is_duplicate
        assert "address_exact" in result.signals


class TestWeakSignals:
    def test_name_alone_not_duplicate(self):
        result = match(rec(name="Acme Excavating"), rec(name="Acme Excavating"))
        assert not result.is_duplicate

    def test_multiple_weak_signals_combine(self):
        # strong name (50) + shared city on partial-name path won't fire; use
        # name_strong (50) + phone would be strong. Two weak: name_partial + city.
        result = match(
            rec(name="Acme Excavating Services", city="Duluth"),
            rec(name="Acme Excavating", city="Duluth"),
        )
        # 2-of-3 tokens overlap -> name_partial(30) or strong; plus city.
        assert result.score >= 50

    def test_different_businesses_not_merged(self):
        result = match(
            rec(name="Acme Excavating", domain="acme.com", city="Duluth"),
            rec(name="Superior Plumbing", domain="superior.com", city="Hibbing"),
        )
        assert not result.is_duplicate
        assert result.score == 0


class TestSuffixInsensitivity:
    def test_llc_vs_inc_same_company(self):
        for suffix_a, suffix_b in [
            ("LLC", "Inc"),
            ("Co", "Corporation"),
            ("Company", "Corp"),
            ("Incorporated", ""),
        ]:
            result = match(
                rec(name=f"Acme Excavating {suffix_a}".strip(), city="Duluth"),
                rec(name=f"Acme Excavating {suffix_b}".strip(), city="Duluth"),
            )
            assert result.is_duplicate, f"{suffix_a} vs {suffix_b}"


class TestFindDuplicate:
    def test_picks_best_match(self):
        existing = [
            rec(id="1", name="Acme Excavating", city="Hibbing"),
            rec(id="2", name="Acme Excavating", domain="acme.com", city="Duluth"),
        ]
        found = find_duplicate(
            rec(name="Acme Excavating LLC", domain="acme.com", city="Duluth"), existing
        )
        assert found is not None
        assert found[0].id == "2"

    def test_none_when_no_match(self):
        existing = [rec(id="1", name="Superior Plumbing", domain="superior.com")]
        assert find_duplicate(rec(name="Acme Excavating", domain="acme.com"), existing) is None
