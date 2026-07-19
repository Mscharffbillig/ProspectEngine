"""Evidence-tied pain hypotheses, framed as questions, never claims."""

from dataclasses import dataclass

from worker.scoring import SignalEvidence

_TEMPLATES: list[tuple[str, str]] = [
    (
        "multiple_crews",
        "Because the company appears to coordinate multiple crews, how are schedule "
        "changes and jobsite updates currently communicated to the field?",
    ),
    (
        "multiple_service_areas",
        "Because the company serves a wide area, how are dispatch decisions and "
        "drive-time tradeoffs currently handled?",
    ),
    (
        "commercial_or_recurring",
        "Because the company performs commercial or recurring work, how are progress "
        "photos, completion documents, and customer approvals collected?",
    ),
    (
        "equipment_heavy",
        "Because the company operates equipment-heavy services, how are maintenance, "
        "location, and availability of machines currently tracked?",
    ),
    (
        "hiring_coordination",
        "Because the company is hiring, how is onboarding and day-one scheduling "
        "information shared with new field staff?",
    ),
    (
        "manual_forms",
        "Because some processes appear to run on printable forms or phone/text "
        "coordination, where does that information get re-entered later?",
    ),
    (
        "quote_driven",
        "Because the company offers free estimates, how are outstanding quotes "
        "tracked and followed up on?",
    ),
    (
        "emergency_service",
        "Because the company offers emergency service, how are after-hours calls "
        "captured, assigned, and billed?",
    ),
]


@dataclass
class Hypothesis:
    signal_key: str
    question: str
    evidence: str
    source_url: str | None


_MIN_CONFIDENCE = {"confirmed", "high"}


def generate_hypotheses(signals: dict[str, SignalEvidence], limit: int = 3) -> list[Hypothesis]:
    """Question hypotheses backed by high-confidence signals only.

    No filler: a business with one supported signal gets one question; a
    business with none gets none (and stays in manual review).
    """
    out: list[Hypothesis] = []
    for signal_key, question in _TEMPLATES:
        evidence = signals.get(signal_key)
        if evidence is None or evidence.confidence not in _MIN_CONFIDENCE:
            continue
        out.append(Hypothesis(signal_key, question, evidence.evidence, evidence.source_url))
        if len(out) >= limit:
            break
    return out
