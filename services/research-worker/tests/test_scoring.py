from worker.extraction import Fact
from worker.scoring import Rule, SignalEvidence, derive_signals, score


def fact(
    key: str, value: str = "x", url: str = "https://acme.com/about", excerpt: str = "excerpt"
) -> Fact:
    return Fact(key, value, "medium", url, excerpt)


RULES = [
    Rule("multiple_crews", "Multiple employees or crews", 15, "multiple_crews"),
    Rule("commercial_or_recurring", "Commercial or recurring work", 10, "commercial_or_recurring"),
    Rule("national_or_franchise", "National company or franchise", -25, "national_or_franchise"),
    Rule("inactive_rule", "Disabled", 100, "multiple_crews", active=False),
]


class TestScore:
    def test_sums_matched_rules_and_records_evidence(self):
        signals = {
            "multiple_crews": SignalEvidence("our three crews", "https://acme.com/about"),
            "commercial_or_recurring": SignalEvidence(
                "commercial snow removal", "https://acme.com"
            ),
        }
        result = score(RULES, signals)
        assert result.total == 25
        assert len(result.applied) == 2
        crews = next(a for a in result.applied if a.rule_key == "multiple_crews")
        assert crews.points == 15
        assert crews.evidence == "our three crews"
        assert crews.source_url == "https://acme.com/about"

    def test_negative_rules_subtract(self):
        signals = {
            "multiple_crews": SignalEvidence("crews"),
            "national_or_franchise": SignalEvidence("franchise opportunities"),
        }
        assert score(RULES, signals).total == -10

    def test_inactive_rules_ignored(self):
        result = score(RULES, {"multiple_crews": SignalEvidence("crews")})
        assert result.total == 15

    def test_unmatched_signals_add_nothing(self):
        assert score(RULES, {}).total == 0


class TestDeriveSignals:
    def test_crews_and_commercial(self):
        signals = derive_signals([fact("multiple_crews"), fact("commercial_work")], page_count=5)
        assert "multiple_crews" in signals
        assert "commercial_or_recurring" in signals
        assert signals["multiple_crews"].source_url == "https://acme.com/about"

    def test_franchise_beats_independent(self):
        signals = derive_signals(
            [fact("franchise_signal"), fact("independent_signal")], page_count=5
        )
        assert "national_or_franchise" in signals
        assert "independent_business" not in signals

    def test_solo_suppressed_by_crews(self):
        signals = derive_signals(
            [fact("solo_operator_signal"), fact("multiple_crews")], page_count=5
        )
        assert "solo_operator" not in signals

    def test_no_web_presence(self):
        signals = derive_signals([], page_count=1)
        assert "no_web_presence" in signals

    def test_decision_maker_from_contacts(self):
        signals = derive_signals([], decision_maker_count=1, page_count=5)
        assert "identifiable_decision_maker" in signals

    def test_software_named(self):
        signals = derive_signals([fact("software_named", "servicetitan")], page_count=5)
        assert "sophisticated_software" in signals
        assert "servicetitan" in signals["sophisticated_software"].evidence
