"""Phase 2A enrichment: pure, bounded logic (no network, no DB).

Everything here is unit-testable. Provider calls live in worker.providers and
orchestration/persistence in worker.handlers.enrich. Nothing in this module
mutates Phase 1 data (facts, contacts, validation, score).
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

# ── per-run provider caps (enforced in code) ─────────────────────────
MAX_BRAVE_QUERIES = 4
MAX_EXTERNAL_PAGES = 6
MAX_HUNTER_REQUESTS = 1
MAX_AI_REQUESTS = 1

VERIFICATION_STATES = ("confirmed", "likely", "unverified", "conflicting", "rejected")

# Roles that would make someone a decision-maker if genuinely tied to the firm.
_OWNER_ROLES = {"owner", "founder"}

# Role phrases -> role_type. Checked most-specific first.
_ROLE_PATTERNS: list[tuple[str, str]] = [
    ("operations manager", "operations_manager"),
    ("operation manager", "operations_manager"),
    ("office manager", "office_manager"),
    ("general manager", "general_manager"),
    ("service manager", "service_manager"),
    ("project manager", "project_manager"),
    ("co-founder", "founder"),
    ("cofounder", "founder"),
    ("founder", "founder"),
    ("owner", "owner"),
    ("president", "owner"),
    ("ceo", "owner"),
    ("proprietor", "owner"),
    ("principal", "owner"),
]

# Contexts that must NEVER be read as ownership. A registered agent is labelled
# as such; the rest are disqualified from being treated as the owner.
_REGISTERED_AGENT_MARKERS = ("registered agent", "registered-agent", "agent for service")
_NON_OWNER_MARKERS = (
    "attorney",
    "lawyer",
    "law firm",
    "law office",
    "esq",
    "accountant",
    "cpa",
    "bookkeeper",
    "web design",
    "web developer",
    "website by",
    "site by",
    "designed by",
    "developed by",
    "powered by",
    "testimonial",
    "reviewed by",
    "wrote a review",
    "customer",
    "client of",
    "partnered with",
    "in partnership with",
    "former",
    "previously",
    "retired",
    "estate of",
)

_GENERIC_EMAIL_PREFIXES = (
    "info@",
    "office@",
    "contact@",
    "hello@",
    "sales@",
    "admin@",
    "service@",
    "support@",
)


@dataclass
class ExternalEvidence:
    query: str | None
    title: str | None
    url: str | None
    domain: str | None
    snippet: str | None
    evidence_type: str = "search_result"
    confidence: str = "low"
    verification_state: str = "unverified"


@dataclass
class ExternalCandidate:
    name: str
    role: str | None
    role_type: str
    company_association: str | None
    source: str  # brave | page | hunter
    method: str  # search_snippet | page_extraction | provider
    verification_state: str
    confidence: str = "low"
    email: str | None = None
    email_type: str | None = None
    provider: str | None = None
    source_url: str | None = None
    excerpt: str | None = None
    provider_score: int | None = None
    fields: dict = field(default_factory=dict)


def build_queries(
    name: str,
    domain: str | None,
    city: str | None,
    state: str | None,
    industry: str | None,
) -> list[str]:
    """At most MAX_BRAVE_QUERIES targeted people/leadership queries for one lead."""
    loc = " ".join(x for x in (city, state) if x).strip()
    dom = (domain or "").strip()
    ind = (industry or "").strip()
    raw = [
        f'"{name}" {loc} owner',
        f'"{name}" founder OR president',
        f'"{name}" operations manager OR office manager',
        f'"{name}" {dom} {ind} leadership OR team',
    ]
    seen: set[str] = set()
    out: list[str] = []
    for q in raw:
        q = " ".join(q.split())
        key = q.lower()
        if q and key not in seen:
            seen.add(key)
            out.append(q)
        if len(out) >= MAX_BRAVE_QUERIES:
            break
    return out[:MAX_BRAVE_QUERIES]


def classify_person(name: str, context: str) -> tuple[str, str]:
    """Return (role_type, verification_state) for a person mentioned near `context`.

    Registered agents are labelled `registered_agent` (never owner). Attorneys,
    accountants, web developers, customers, testimonial authors, partners, and
    former staff are never classified as owners even if an owner-ish word appears.
    """
    ctx = (context or "").lower()
    if any(m in ctx for m in _REGISTERED_AGENT_MARKERS):
        return "registered_agent", "likely"

    disqualified = any(m in ctx for m in _NON_OWNER_MARKERS)
    for phrase, role_type in _ROLE_PATTERNS:
        if phrase in ctx:
            if role_type in _OWNER_ROLES and disqualified:
                # Owner-looking title in a disqualifying context: reject as owner.
                return "other", "rejected"
            return role_type, "likely"
    return "unknown", "unverified"


def make_candidate(
    name: str,
    context: str,
    *,
    source: str,
    method: str,
    source_url: str | None = None,
    excerpt: str | None = None,
    company_association: str | None = None,
) -> ExternalCandidate | None:
    """Build a candidate, dropping ones rejected outright (e.g. disqualified owner)."""
    name = (name or "").strip()
    if not name:
        return None
    role_type, verification = classify_person(name, context)
    if verification == "rejected":
        return None
    return ExternalCandidate(
        name=name,
        role=None,
        role_type=role_type,
        company_association=company_association,
        source=source,
        method=method,
        verification_state=verification,
        confidence="low" if verification == "unverified" else "medium",
        source_url=source_url,
        excerpt=(excerpt or context)[:300] if (excerpt or context) else None,
    )


def is_verified_decision_maker(candidate: ExternalCandidate) -> bool:
    """Only confirmed candidates may be auto-used as a verified decision-maker.

    Enrichment never sets 'confirmed' on an external person — that requires
    operator confirmation via the Phase 1 corrections flow — so likely/unverified
    research candidates are never used automatically in personalized outreach.
    """
    return candidate.verification_state == "confirmed"


def classify_email_type(
    email: str | None,
    *,
    provider_verified: bool = False,
    provider_pattern: bool = False,
    website_published: bool = False,
) -> str | None:
    """Label an email by trustworthiness; a guessed pattern is never 'verified'."""
    if not email:
        return None
    if provider_pattern:
        return "pattern_unverified"
    if website_published:
        return "website_published"
    if provider_verified:
        return "provider_verified"
    if email.lower().startswith(_GENERIC_EMAIL_PREFIXES):
        return "generic"
    return "provider_suggested"


def assess_contact_readiness(
    *,
    do_not_contact: bool,
    has_verified_direct_contact: bool,
    has_general_channel: bool,
    has_uncertain_candidate: bool,
) -> str:
    """Contact-readiness status, independent of business-fit score."""
    if do_not_contact:
        return "not_contactable"
    if has_verified_direct_contact:
        return "ready_direct"
    if has_general_channel:
        return "ready_general"
    if has_uncertain_candidate:
        return "needs_manual_verification"
    return "needs_contact_enrichment"


def should_skip_enrichment(
    last_completed_at: datetime | None,
    now: datetime,
    force: bool,
    cache_days: int,
) -> bool:
    """True when a fresh successful run exists and Force refresh was not chosen."""
    if force or last_completed_at is None:
        return False
    return (now - last_completed_at) < timedelta(days=cache_days)


# Fields whose items are factual claims and MUST cite stored evidence IDs.
_CLAIM_FIELDS = (
    "strongest_operational_signals",
    "possible_workflow_problems",
    "possible_custom_software_angles",
    "existing_software_or_competitor_risk",
    "disqualifiers",
)
_QUESTION_FIELDS = ("discovery_questions", "unresolved_questions")


def sanitize_ai_analysis(raw: object, valid_evidence_ids: set[str]) -> dict:
    """Enforce the AI-output contract.

    Every factual claim must reference at least one known evidence ID; claims
    with missing or unknown references are dropped (no unsupported statements
    survive). Questions carry no references. A weak evidence set therefore yields
    a cautious/empty analysis rather than invented content.
    """
    if not isinstance(raw, dict):
        return {}
    out: dict = {"business_summary": str(raw.get("business_summary", "")).strip()}
    for f in _CLAIM_FIELDS:
        kept = []
        for item in raw.get(f) or []:
            if not isinstance(item, dict):
                continue
            refs = [r for r in (item.get("evidence_ids") or []) if r in valid_evidence_ids]
            text = (
                item.get("statement") or item.get("hypothesis") or item.get("text") or ""
            ).strip()
            if not refs or not text:
                continue
            kept.append(
                {
                    "text": text,
                    "evidence_ids": refs,
                    "is_hypothesis": f == "possible_workflow_problems",
                }
            )
        out[f] = kept
    for f in _QUESTION_FIELDS:
        out[f] = [str(q).strip() for q in (raw.get(f) or []) if str(q).strip()][:8]
    out["recommended_contact_path"] = str(raw.get("recommended_contact_path", "")).strip()
    conf = str(raw.get("overall_confidence", "low")).lower()
    out["overall_confidence"] = conf if conf in ("high", "medium", "low") else "low"
    return out
