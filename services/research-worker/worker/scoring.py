"""Transparent rules-engine scoring.

Signals are derived from stored facts/contacts, each carrying the confidence
of its supporting evidence. Rules (loaded from the qualification_rules table)
map signal keys to points and may demand a minimum evidence confidence via
definition.min_confidence — major positive rules require "high". Missing
evidence never produces a signal.

v2.0: confidence gating, contextual-evidence extraction, decision-makers only
from validated contacts, contactability de-weighted.
"""

from dataclasses import dataclass, field

from worker.extraction import Fact

SCORING_VERSION = "2.0"

CONFIDENCE_RANK = {"confirmed": 4, "high": 3, "medium": 2, "low": 1, "unknown": 0}


@dataclass
class SignalEvidence:
    evidence: str
    source_url: str | None = None
    confidence: str = "medium"


@dataclass
class Rule:
    rule_key: str
    label: str
    points: int
    signal: str
    active: bool = True
    min_confidence: str = "medium"
    category: str = "fit"  # eligibility | fit | contactability | workflow


@dataclass
class AppliedRule:
    rule_key: str
    label: str
    points: int
    evidence: str
    source_url: str | None
    confidence: str


@dataclass
class ScoreResult:
    total: int
    applied: list[AppliedRule] = field(default_factory=list)
    version: str = SCORING_VERSION


def _best_fact(facts: list[Fact], key: str, min_confidence: str = "low") -> Fact | None:
    """Highest-confidence fact for a key, if it meets the bar."""
    candidates = [f for f in facts if f.key == key]
    if not candidates:
        return None
    best = max(candidates, key=lambda f: CONFIDENCE_RANK.get(f.confidence, 0))
    if CONFIDENCE_RANK.get(best.confidence, 0) < CONFIDENCE_RANK[min_confidence]:
        return None
    return best


def _signal_from(fact: Fact | None) -> SignalEvidence | None:
    if fact is None:
        return None
    return SignalEvidence(fact.excerpt, fact.source_url, fact.confidence)


def derive_signals(
    facts: list[Fact],
    contact_count: int = 0,
    decision_maker_count: int = 0,
    page_count: int = 0,
) -> dict[str, SignalEvidence]:
    """Map extracted facts to the signal keys that scoring rules reference."""
    signals: dict[str, SignalEvidence] = {}

    def put(key: str, evidence: SignalEvidence | None) -> None:
        if evidence is not None:
            signals[key] = evidence

    # Decision-makers come only from validated contacts (worker.people gates
    # them to high/confirmed confidence) — never from raw text facts.
    if decision_maker_count > 0:
        signals["identifiable_decision_maker"] = SignalEvidence(
            f"{decision_maker_count} validated decision-maker contact(s)", None, "high"
        )

    put("multiple_crews", _signal_from(_best_fact(facts, "multiple_crews")))

    area = _best_fact(facts, "service_area", min_confidence="high")
    locations = _best_fact(facts, "multiple_locations", min_confidence="high")
    put("multiple_service_areas", _signal_from(area or locations))

    commercial = _best_fact(facts, "commercial_work", min_confidence="medium")
    recurring = _best_fact(facts, "recurring_service", min_confidence="medium")
    put("commercial_or_recurring", _signal_from(commercial or recurring))

    put("manual_forms", _signal_from(_best_fact(facts, "manual_forms")))
    put("hiring_coordination", _signal_from(_best_fact(facts, "hiring")))

    contact = _best_fact(facts, "phone") or _best_fact(facts, "email")
    if contact is not None or contact_count > 0:
        signals["public_contact"] = SignalEvidence(
            contact.excerpt if contact else "contact record on file",
            contact.source_url if contact else None,
            contact.confidence if contact else "medium",
        )

    franchise = _best_fact(facts, "franchise_signal")
    if franchise is not None:
        put("national_or_franchise", _signal_from(franchise))
    else:
        put("independent_business", _signal_from(_best_fact(facts, "independent_signal")))

    put("equipment_heavy", _signal_from(_best_fact(facts, "equipment_heavy")))

    solo = _best_fact(facts, "solo_operator_signal")
    if solo is not None and "multiple_crews" not in signals:
        put("solo_operator", _signal_from(solo))

    if page_count <= 1:
        signals["no_web_presence"] = SignalEvidence(
            f"only {page_count} page(s) found", None, "high"
        )

    software = _best_fact(facts, "software_named")
    if software is not None:
        signals["sophisticated_software"] = SignalEvidence(
            f"uses {software.value}: {software.excerpt}", software.source_url, software.confidence
        )

    # Signals that only feed pain hypotheses (no scoring rule references them).
    for extra_key in ("quote_driven", "emergency_service", "recurring_service"):
        fact = _best_fact(facts, extra_key)
        if fact is not None:
            signals.setdefault(extra_key, _signal_from(fact))  # type: ignore[arg-type]

    return signals


def score(rules: list[Rule], signals: dict[str, SignalEvidence]) -> ScoreResult:
    result = ScoreResult(total=0)
    for rule in rules:
        if not rule.active:
            continue
        evidence = signals.get(rule.signal)
        if evidence is None:
            continue
        if CONFIDENCE_RANK.get(evidence.confidence, 0) < CONFIDENCE_RANK.get(
            rule.min_confidence, 2
        ):
            continue
        result.total += rule.points
        result.applied.append(
            AppliedRule(
                rule_key=rule.rule_key,
                label=rule.label,
                points=rule.points,
                evidence=evidence.evidence,
                source_url=evidence.source_url,
                confidence=evidence.confidence,
            )
        )
    return result
