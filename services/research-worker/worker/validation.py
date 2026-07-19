"""Hard candidate-validation gates, separate from scoring.

A business can only be marked qualified when every gate passes, regardless of
its numerical score. Outcomes and reasons are stored for the review UI.
"""

import re
from dataclasses import dataclass, field

from worker.crawler import FetchedPage
from worker.extraction import Fact
from worker.identity import NameResolution
from worker.normalize import normalize_state

VALIDATION_STATES = (
    "pending_validation",
    "valid",
    "invalid",
    "ambiguous",
    "manual_review_required",
)

_NOT_A_BUSINESS_RE = re.compile(
    r"\b(?:association|chamber of commerce|magazine|news(?:paper)?|wiki|"
    r"encyclopedia|university|nonprofit|directory|top \d+ (?:best|rated)|"
    r"find (?:a|the best) (?:contractor|company|pro)s?)\b",
    re.I,
)
_ARTICLE_RE = re.compile(
    r"\b(?:posted (?:on|by)|written by|read more articles|min read|"
    r"leave a (?:comment|reply)|related (?:posts|articles))\b",
    re.I,
)
_JOB_LISTING_RE = re.compile(
    r"\b(?:apply for this job|job openings near|salary range|per hour.*benefits|"
    r"equal opportunity employer statement)\b",
    re.I,
)

_MIN_MEANINGFUL_CHARS = 400


@dataclass
class ValidationResult:
    state: str
    reasons: list[str] = field(default_factory=list)
    # check name -> {"passed": bool, "detail": str}
    checks: dict[str, dict] = field(default_factory=dict)


def _industry_terms(industries: list[str]) -> list[str]:
    """Expand campaign industries into matchable stems."""
    expansions = {
        "excavation": ["excavat", "grading", "sitework", "site prep", "demolition", "trenching"],
        "hvac": ["hvac", "heating", "cooling", "furnace", "air conditioning", "ventilation"],
        "plumbing": ["plumb", "water heater", "sewer", "drain"],
        "landscaping": ["landscap", "lawn", "hardscap", "snow removal", "mowing", "patio"],
        "restoration": ["restoration", "water damage", "fire damage", "mold", "remediation"],
        "commercial cleaning": ["cleaning", "janitorial", "custodial", "porter"],
        "equipment repair": ["equipment repair", "machine repair", "engine repair", "small engine"],
        "small manufacturing": ["manufactur", "machin", "fabricat", "welding", "cnc"],
    }
    terms: list[str] = []
    for industry in industries:
        terms.extend(expansions.get(industry.lower(), [industry.lower()]))
    return terms


def _geography_terms(locations: list[str]) -> list[str]:
    terms: list[str] = []
    for location in locations:
        cleaned = location.lower().removeprefix("western ").removeprefix("eastern ").strip()
        terms.append(cleaned)
        code = normalize_state(cleaned)
        if len(code) == 2:
            terms.append(code)
    return terms


def validate_business(
    pages: list[FetchedPage],
    facts: list[Fact],
    name_resolution: NameResolution | None,
    industries: list[str],
    locations: list[str],
    business_state: str | None = None,
) -> ValidationResult:
    checks: dict[str, dict] = {}
    reasons: list[str] = []
    needs_review = False

    text = "\n".join(p.text for p in pages)
    lower = text.lower()

    # Gate: successful crawl with meaningful business content.
    meaningful = len(text) >= _MIN_MEANINGFUL_CHARS and len(pages) >= 1
    checks["crawl"] = {
        "passed": meaningful,
        "detail": f"{len(pages)} page(s), {len(text)} chars of content",
    }
    if not pages:
        reasons.append("crawl_failed")
    elif not meaningful:
        reasons.append("no_meaningful_content")

    # Gate: looks like an operating business, not an article/directory/etc.
    has_contact = any(f.key in ("phone", "email", "address") for f in facts)
    not_business = _NOT_A_BUSINESS_RE.search(lower)
    article = _ARTICLE_RE.search(lower)
    job_listing = _JOB_LISTING_RE.search(lower)
    operating = meaningful and has_contact and not (not_business or article or job_listing)
    detail = "contact info published" if has_contact else "no phone/email/address found"
    if not_business:
        detail = f"directory/association language: “{not_business.group(0)}”"
        reasons.append("directory_or_aggregator")
    elif article:
        detail = f"article/blog language: “{article.group(0)}”"
        reasons.append("article_or_blog")
    elif job_listing:
        detail = f"job-listing language: “{job_listing.group(0)}”"
        reasons.append("job_listing")
    elif meaningful and not has_contact:
        reasons.append("not_a_business")
    checks["operating_business"] = {"passed": bool(operating), "detail": detail}

    # Gate: target-industry match.
    matched_industry = next((t for t in _industry_terms(industries) if t in lower), None)
    checks["industry"] = {
        "passed": matched_industry is not None,
        "detail": f"matched “{matched_industry}”"
        if matched_industry
        else "no industry terms found",
    }
    if industries and matched_industry is None:
        reasons.append("wrong_industry")

    # Gate: target-geography match (site text or extracted state).
    geo_terms = _geography_terms(locations)
    target_states = {t.upper() for t in geo_terms if len(t) == 2}
    matched_geo = next((t for t in geo_terms if len(t) > 2 and t in lower), None)
    if matched_geo is None and business_state and business_state.upper() in target_states:
        matched_geo = business_state
    if matched_geo is None:
        state_hit = next((s for s in target_states if re.search(rf"\b{s}\b", text)), None)
        matched_geo = state_hit
    checks["geography"] = {
        "passed": matched_geo is not None,
        "detail": f"matched “{matched_geo}”" if matched_geo else "no target locations found",
    }
    if locations and matched_geo is None:
        reasons.append("wrong_geography")

    # Gate: business identity resolved with acceptable confidence.
    identity_ok = name_resolution is not None and name_resolution.confidence in (
        "confirmed",
        "high",
        "medium",
    )
    checks["identity"] = {
        "passed": bool(identity_ok),
        "detail": (
            f"{name_resolution.name!r} via {name_resolution.source} ({name_resolution.confidence})"
            if name_resolution
            else "no name resolution"
        ),
    }
    if not identity_ok:
        reasons.append("identity_unconfirmed")
        needs_review = True

    # Gate: franchise/national companies are excluded by campaign policy.
    franchise = next(
        (f for f in facts if f.key == "franchise_signal" and f.confidence in ("high", "confirmed")),
        None,
    )
    checks["independent"] = {
        "passed": franchise is None,
        "detail": franchise.excerpt[:120] if franchise else "no franchise/national signals",
    }
    if franchise is not None:
        reasons.append("franchise_or_national_company")

    hard_failures = [r for r in reasons if r != "identity_unconfirmed"]
    if hard_failures:
        state = "invalid"
    elif needs_review:
        state = "manual_review_required"
    else:
        state = "valid"
    return ValidationResult(state=state, reasons=reasons, checks=checks)
