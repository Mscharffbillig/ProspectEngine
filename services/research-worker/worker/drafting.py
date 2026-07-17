"""Template-based outreach drafting grounded in stored evidence.

Only saved facts/hypotheses are referenced; nothing is invented. AI drafting
(Phase 2) plugs in behind the same function signature via the ai provider
abstraction, and must also work only from these inputs.
"""

from dataclasses import dataclass

SENDER_NAME = "Mickey"


@dataclass
class DraftInput:
    company_name: str
    industry: str | None
    location: str | None
    contact_first_name: str | None
    characteristic: str | None  # evidence-backed characteristic sentence fragment
    workflow_question: str | None  # from a pain hypothesis


def build_characteristic(signals: dict[str, str]) -> str | None:
    """Pick one evidence-backed characteristic phrase from derived signal keys."""
    preferred = [
        ("multiple_crews", "coordinate multiple crews"),
        ("multiple_service_areas", "cover a wide service area"),
        ("commercial_or_recurring", "handle commercial and recurring work"),
        ("equipment_heavy", "run an equipment-heavy operation"),
        ("independent_business", "run an independent, locally owned operation"),
    ]
    for key, phrase in preferred:
        if key in signals:
            return phrase
    return None


def render_draft(inp: DraftInput) -> tuple[str, str]:
    """Return (subject, body) for a first-touch message."""
    greeting = f"Hi {inp.contact_first_name}," if inp.contact_first_name else "Hi,"
    industry = inp.industry or "service"
    location = inp.location or "your area"

    characteristic_line = f"It looks like you {inp.characteristic}." if inp.characteristic else ""
    question = (
        inp.workflow_question
        or "how day-to-day scheduling and job information move between the office and the field"
    )

    body_parts = [
        greeting,
        "",
        "I work in operations at an independent repair shop and also build small "
        "software tools for businesses.",
        "",
        f"I came across {inp.company_name} while researching {industry.lower()} "
        f"companies in {location}. {characteristic_line}".strip(),
        "",
        "I'm speaking with business owners about processes still handled through "
        "spreadsheets, paper, texts, duplicate data entry, or memory. I'm especially "
        f"interested in {_as_clause(question)}",
        "",
        "Would you be open to a brief 15-20 minute conversation? I'm researching "
        "common workflow problems rather than pitching a large software platform.",
        "",
        "Thanks,",
        SENDER_NAME,
    ]
    subject = f"Question about workflows at {inp.company_name}"
    return subject, "\n".join(body_parts)


def _as_clause(question: str) -> str:
    """Turn a standalone hypothesis question into an embedded clause."""
    q = question.strip().rstrip("?").rstrip(".")
    # Strip the "Because ..." framing if present; keep the "how ..." core.
    lower = q.lower()
    how = lower.find("how ")
    if how > 0:
        q = q[how:]
    if not q.lower().startswith("how"):
        q = "how " + q
    return q[0].lower() + q[1:] + "."
