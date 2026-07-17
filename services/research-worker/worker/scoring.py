"""Transparent rules-engine scoring.

Signals are derived from stored facts/contacts; rules (loaded from the
qualification_rules table) map signal keys to points. Every applied rule
records its evidence so the review UI can show exactly why a score exists.
"""

from dataclasses import dataclass, field

from worker.extraction import Fact

SCORING_VERSION = "1.0"


@dataclass
class SignalEvidence:
    evidence: str
    source_url: str | None = None


@dataclass
class Rule:
    rule_key: str
    label: str
    points: int
    signal: str
    active: bool = True


@dataclass
class AppliedRule:
    rule_key: str
    label: str
    points: int
    evidence: str
    source_url: str | None


@dataclass
class ScoreResult:
    total: int
    applied: list[AppliedRule] = field(default_factory=list)
    version: str = SCORING_VERSION


def derive_signals(
    facts: list[Fact],
    contact_count: int = 0,
    decision_maker_count: int = 0,
    page_count: int = 0,
) -> dict[str, SignalEvidence]:
    """Map extracted facts to the signal keys that scoring rules reference."""
    by_key: dict[str, list[Fact]] = {}
    for fact in facts:
        by_key.setdefault(fact.key, []).append(fact)

    def first(key: str) -> Fact | None:
        items = by_key.get(key)
        return items[0] if items else None

    signals: dict[str, SignalEvidence] = {}

    if decision_maker_count > 0 or first("person_role"):
        fact = first("person_role")
        signals["identifiable_decision_maker"] = SignalEvidence(
            fact.excerpt if fact else f"{decision_maker_count} named decision-maker contact(s)",
            fact.source_url if fact else None,
        )

    if (fact := first("multiple_crews")) is not None:
        signals["multiple_crews"] = SignalEvidence(fact.excerpt, fact.source_url)

    area_fact = first("service_area") or first("multiple_locations")
    if area_fact is not None:
        signals["multiple_service_areas"] = SignalEvidence(area_fact.excerpt, area_fact.source_url)

    commercial = first("commercial_work") or first("recurring_service")
    if commercial is not None:
        signals["commercial_or_recurring"] = SignalEvidence(
            commercial.excerpt, commercial.source_url
        )

    if (fact := first("manual_forms")) is not None:
        signals["manual_forms"] = SignalEvidence(fact.excerpt, fact.source_url)

    if (fact := first("hiring")) is not None:
        signals["hiring_coordination"] = SignalEvidence(fact.excerpt, fact.source_url)

    contact = first("phone") or first("email") or first("contact_form")
    if contact is not None or contact_count > 0:
        signals["public_contact"] = SignalEvidence(
            contact.excerpt if contact else "contact record on file",
            contact.source_url if contact else None,
        )

    if first("franchise_signal") is not None:
        fact = first("franchise_signal")
        signals["national_or_franchise"] = SignalEvidence(fact.excerpt, fact.source_url)
    elif (fact := first("independent_signal")) is not None:
        signals["independent_business"] = SignalEvidence(fact.excerpt, fact.source_url)

    if (fact := first("equipment_heavy")) is not None:
        signals["equipment_heavy"] = SignalEvidence(fact.excerpt, fact.source_url)

    if (fact := first("solo_operator_signal")) is not None and "multiple_crews" not in signals:
        signals["solo_operator"] = SignalEvidence(fact.excerpt, fact.source_url)

    if page_count <= 1:
        signals["no_web_presence"] = SignalEvidence(f"only {page_count} page(s) found")

    if (fact := first("software_named")) is not None:
        signals["sophisticated_software"] = SignalEvidence(
            f"uses {fact.value}: {fact.excerpt}", fact.source_url
        )

    # Signals that only feed pain hypotheses (no scoring rule references them).
    for extra_key in ("quote_driven", "emergency_service", "recurring_service"):
        if (fact := first(extra_key)) is not None:
            signals.setdefault(extra_key, SignalEvidence(fact.excerpt, fact.source_url))

    return signals


def score(rules: list[Rule], signals: dict[str, SignalEvidence]) -> ScoreResult:
    result = ScoreResult(total=0)
    for rule in rules:
        if not rule.active:
            continue
        evidence = signals.get(rule.signal)
        if evidence is None:
            continue
        result.total += rule.points
        result.applied.append(
            AppliedRule(
                rule_key=rule.rule_key,
                label=rule.label,
                points=rule.points,
                evidence=evidence.evidence,
                source_url=evidence.source_url,
            )
        )
    return result
