"""Canonical company-name resolution with identity-coherence checks.

Candidates are gathered from every ranked source (JSON-LD, og:site_name,
header brand, logo alt, footer legal name, homepage title) and validated:
malformed candidates are dropped, and a candidate that does not cohere with
the website domain needs at least two independent agreeing sources before it
can replace a reasonable provisional name. Third-party names (customers,
partners, site developers) therefore never win on a single mention.

Every candidate is preserved on the resolution for auditability.
"""

import re
from dataclasses import dataclass, field

from worker.crawler import FetchedPage

# Words that mark a candidate as a service/SEO phrase rather than a brand.
_GENERIC_NAME_WORDS = {
    "hvac",
    "heating",
    "cooling",
    "plumbing",
    "plumber",
    "excavation",
    "excavating",
    "landscaping",
    "landscape",
    "cleaning",
    "restoration",
    "repair",
    "contractor",
    "contractors",
    "company",
    "companies",
    "services",
    "service",
    "commercial",
    "residential",
    "top-rated",
    "rated",
    "best",
    "affordable",
    "local",
    "professional",
    "licensed",
    "insured",
    "experts",
    "expert",
    "solutions",
    "near",
    "me",
    "in",
    "mn",
    "wi",
    "minnesota",
    "wisconsin",
    "minneapolis",
    "duluth",
    "area",
    "metro",
    "cities",
    "twin",
    "home",
    "welcome",
    "snow",
    "removal",
    "lawn",
    "care",
    "grading",
    "construction",
    "sewer",
    "septic",
    "and",
}

_CTA_NAMES = {
    "home",
    "contact",
    "contact us",
    "about",
    "about us",
    "services",
    "welcome",
    "learn more",
    "get a quote",
    "request a quote",
    "free estimate",
    "menu",
    "careers",
    "gallery",
    "testimonials",
}

# Error/interstitial page titles must never become a business name.
_ERROR_TITLE_RE = re.compile(
    r"(?i)\b(?:40[034]|50[023]|forbidden|not found|access denied|error|"
    r"just a moment|attention required|page unavailable)\b"
)

# Single tokens ending in a chopped industry stem look truncated ("gerkeexcavat").
_TRUNCATED_STEM_RE = re.compile(
    r"(?:excavat|plumb|landscap|construc|contract|heatin|coolin|remodel|"
    r"restor|manufactur|fabricat|clean)$"
)

_FOOTER_LEGAL_RE = re.compile(
    r"(?:©|\(c\)|copyright)\s*(?:\d{4})?\s*"
    r"([A-Z][\w&'.,-]*(?:\s+[\w&'.,-]+){0,5}?(?:,?\s+(?:Inc|LLC|Co|Corp|Ltd)\.?)?)"
    r"(?=\s*(?:·|\||All rights|$))"
)

_SOURCE_RANK = {
    "json_ld": 6,
    "og_site_name": 5,
    "header_brand": 4,
    "logo_alt": 4,
    "footer_legal": 3,
    "homepage_title": 2,
    "search_title": 1,
}
_SOURCE_CONFIDENCE = {
    "json_ld": "confirmed",
    "og_site_name": "high",
    "header_brand": "high",
    "logo_alt": "high",
    "footer_legal": "medium",
    "homepage_title": "medium",
    "search_title": "low",
}


@dataclass
class NameCandidate:
    name: str
    source: str
    confidence: str
    source_url: str | None
    evidence: str
    coherent: bool = False
    malformed: bool = False


@dataclass
class NameResolution:
    name: str
    confidence: str  # confirmed | high | medium | low
    source: str
    source_url: str | None
    evidence: str
    conflict: bool = False
    conflict_detail: str = ""
    candidates: list[NameCandidate] = field(default_factory=list)


def is_generic_name(name: str) -> bool:
    """True when a candidate is a service/SEO phrase, not a real brand name."""
    tokens = [t.lower().strip(".,'’!|-") for t in name.split() if t.strip(".,'’!|-")]
    if not tokens:
        return True
    generic = sum(
        1 for t in tokens if t in _GENERIC_NAME_WORDS or t.removesuffix("'s") in _GENERIC_NAME_WORDS
    )
    if len(tokens) == 1:
        return tokens[0] in _GENERIC_NAME_WORDS
    return generic / len(tokens) >= 0.6


def is_malformed_name(name: str) -> bool:
    """Truncated names, domain slugs, CTA/nav text, error pages, generic labels."""
    name = name.strip()
    if not name:
        return True
    if _ERROR_TITLE_RE.search(name):
        return True
    if name.lower() in _CTA_NAMES:
        return True
    if is_generic_name(name):
        return True
    if name == name.lower():
        return True  # no capitalization at all: raw slug ("albiero-plumbing")
    # Single-token checks (hyphenated brands like Genz-Ryan count as two).
    tokens = name.replace("-", " ").split()
    if len(tokens) == 1:
        token = tokens[0]
        if token.isupper() and len(token) <= 6:
            return False  # acronym brands (ATK)
        if token.islower():
            return True  # raw domain slug
        if _TRUNCATED_STEM_RE.search(token.lower()) and not token.lower().endswith(
            (
                "excavating",
                "plumbing",
                "landscaping",
                "heating",
                "cooling",
                "construction",
                "contracting",
                "cleaning",
                "restoration",
            )
        ):
            return True
    else:
        # Truncated last word ("Gerke Excavat").
        last = tokens[-1].lower().strip(".,")
        if _TRUNCATED_STEM_RE.search(last) and not last.endswith(
            (
                "excavating",
                "plumbing",
                "landscaping",
                "heating",
                "cooling",
                "construction",
                "contracting",
                "cleaning",
                "restoration",
            )
        ):
            return True
    return False


def _domain_core(domain: str) -> str:
    host = domain.lower().removeprefix("www.")
    return re.sub(r"[^a-z0-9]", "", host.split(".")[0])


def _compact_variants(name: str) -> list[str]:
    base = name.lower()
    variants = [base, base.replace("&", " and "), base.replace(" and ", " ")]
    return [re.sub(r"[^a-z0-9]", "", v) for v in variants if v]


def names_coherent(name: str, domain: str | None) -> bool:
    """Does this name plausibly belong to this domain?"""
    if not domain:
        return False
    core = _domain_core(domain)
    if len(core) < 3:
        return False
    for compact in _compact_variants(name):
        if compact and (compact in core or core in compact):
            return True
    tokens = [
        t.lower().strip(".,'’-")
        for t in name.split()
        if len(t.strip(".,'’-")) >= 4 and t.lower().strip(".,'’-") not in _GENERIC_NAME_WORDS
    ]
    if any(t in core for t in tokens):
        return True
    initials = "".join(t[0].lower() for t in name.split() if t and t[0].isalpha())
    return len(initials) >= 3 and initials in core


def _clean_title(title: str) -> str:
    """Take the brand part of a page title, dropping SEO/location segments."""
    for separator in (" | ", " – ", " — ", " - ", " :: "):
        if separator in title:
            parts = [p.strip() for p in title.split(separator)]
            for part in parts:
                if part and not is_generic_name(part):
                    return part
            return parts[0]
    return title.strip()


def _gather_candidates(pages: list[FetchedPage]) -> list[NameCandidate]:
    candidates: list[NameCandidate] = []

    def add(name: str, source: str, url: str | None, evidence: str) -> None:
        name = name.strip(" ,")  # keep trailing periods ("Inc.")
        if not name:
            return
        candidates.append(
            NameCandidate(
                name=name,
                source=source,
                confidence=_SOURCE_CONFIDENCE[source],
                source_url=url,
                evidence=evidence[:200],
                malformed=is_malformed_name(name),
            )
        )

    homepage = pages[0] if pages else None
    for page in pages:
        for org in page.meta.get("json_ld_orgs", []):
            add(
                org.get("name", ""),
                "json_ld",
                page.url,
                f"JSON-LD {'/'.join(org.get('types', []))}",
            )
        og = page.meta.get("og_site_name", "").strip()
        if og:
            add(og, "og_site_name", page.url, "og:site_name meta tag")
        footer = page.meta.get("footer_text", "")
        match = _FOOTER_LEGAL_RE.search(footer)
        if match:
            add(match.group(1), "footer_legal", page.url, f"footer: {footer[:120]}")
    if homepage is not None:
        brand = homepage.meta.get("header_brand", "").strip()
        if brand:
            add(brand, "header_brand", homepage.url, "header brand link")
        alt = homepage.meta.get("logo_alt", "").strip()
        if alt:
            add(alt, "logo_alt", homepage.url, "logo alt text")
        if homepage.title and not _ERROR_TITLE_RE.search(homepage.title):
            add(
                _clean_title(homepage.title),
                "homepage_title",
                homepage.url,
                f"title: {homepage.title[:120]}",
            )
    return candidates


def _same_name(a: str, b: str) -> bool:
    ca, cb = _compact_variants(a)[0], _compact_variants(b)[0]
    return bool(ca) and bool(cb) and (ca == cb or ca in cb or cb in ca)


def resolve_company_name(
    pages: list[FetchedPage],
    fallback_title: str | None,
    domain: str | None = None,
) -> NameResolution:
    if domain is None and pages:
        match = re.match(r"https?://([^/]+)", pages[0].url)
        domain = match.group(1) if match else None

    candidates = _gather_candidates(pages)
    for candidate in candidates:
        candidate.coherent = names_coherent(candidate.name, domain)
    usable = [c for c in candidates if not c.malformed]

    provisional = _clean_title(fallback_title) if fallback_title else ""
    if not provisional or is_malformed_name(provisional):
        provisional = provisional or (fallback_title or "Unknown business")

    def _resolution(c: NameCandidate, conflict: bool = False, detail: str = "") -> NameResolution:
        return NameResolution(
            name=c.name,
            confidence=c.confidence,
            source=c.source,
            source_url=c.source_url,
            evidence=c.evidence,
            conflict=conflict,
            conflict_detail=detail,
            candidates=candidates,
        )

    # 1. Best domain-coherent candidate wins (site-wide/domain evidence first).
    coherent = sorted(
        (c for c in usable if c.coherent),
        key=lambda c: _SOURCE_RANK[c.source],
        reverse=True,
    )
    if coherent:
        return _resolution(coherent[0])

    # 2. No coherent candidate: accept a materially different name only when at
    #    least two independent sources agree on it.
    for candidate in sorted(usable, key=lambda c: _SOURCE_RANK[c.source], reverse=True):
        agreeing_sources = {c.source for c in usable if _same_name(c.name, candidate.name)}
        if len(agreeing_sources) >= 2:
            return _resolution(
                candidate,
                detail=f"accepted despite domain mismatch: {sorted(agreeing_sources)} agree",
            )

    # 3. Keep the provisional name. Strong single-source disagreement (a
    #    third-party or unexplained identity) is an unresolved conflict.
    strong_disagreement = next((c for c in usable if c.confidence in ("confirmed", "high")), None)
    conflict = strong_disagreement is not None
    detail = (
        f"{strong_disagreement.source} names {strong_disagreement.name!r} but it does not "
        f"match domain {domain!r} and no second source agrees"
        if strong_disagreement
        else ""
    )
    return NameResolution(
        name=provisional,
        confidence="low",
        source="search_title",
        source_url=None,
        evidence=f"provisional from search/previous name: {fallback_title!r}",
        conflict=conflict,
        conflict_detail=detail,
        candidates=candidates,
    )
