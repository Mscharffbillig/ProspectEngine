"""Canonical company-name resolution from ranked website evidence.

Search-result titles are provisional display names only; after crawling, the
name is resolved from (best first): JSON-LD organization, og:site_name,
header brand / logo alt, footer legal name, cleaned homepage title, and only
then the search title at low confidence.
"""

import re
from dataclasses import dataclass

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
}

# Error/interstitial page titles must never become a business name.
_ERROR_TITLE_RE = re.compile(
    r"(?i)\b(?:40[034]|50[023]|forbidden|not found|access denied|error|"
    r"just a moment|attention required|page unavailable)\b"
)

_FOOTER_LEGAL_RE = re.compile(
    r"(?:©|\(c\)|copyright)\s*(?:\d{4})?\s*"
    r"([A-Z][\w&'.,-]*(?:\s+[\w&'.,-]+){0,5}?(?:,?\s+(?:Inc|LLC|Co|Corp|Ltd)\.?)?)"
    r"(?=\s*(?:·|\||All rights|$))"
)


@dataclass
class NameResolution:
    name: str
    confidence: str  # confirmed | high | medium | low
    source: str  # json_ld | og_site_name | header_brand | logo_alt | footer_legal | homepage_title | search_title
    source_url: str | None
    evidence: str


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


def resolve_company_name(pages: list[FetchedPage], fallback_title: str | None) -> NameResolution:
    homepage = pages[0] if pages else None

    for page in pages:
        for org in page.meta.get("json_ld_orgs", []):
            name = org.get("name", "").strip()
            if name and not is_generic_name(name):
                return NameResolution(
                    name,
                    "confirmed",
                    "json_ld",
                    page.url,
                    f"JSON-LD {'/'.join(org.get('types', []))}",
                )

    for page in pages:
        og = page.meta.get("og_site_name", "").strip()
        if og and not is_generic_name(og):
            return NameResolution(og, "high", "og_site_name", page.url, "og:site_name meta tag")

    if homepage is not None:
        brand = homepage.meta.get("header_brand", "").strip()
        if brand and not is_generic_name(brand):
            return NameResolution(brand, "high", "header_brand", homepage.url, "header brand link")
        alt = homepage.meta.get("logo_alt", "").strip()
        if alt and not is_generic_name(alt):
            return NameResolution(alt, "high", "logo_alt", homepage.url, "logo alt text")

    for page in pages:
        footer = page.meta.get("footer_text", "")
        match = _FOOTER_LEGAL_RE.search(footer)
        if match:
            name = match.group(1).strip(" .,")
            if name and not is_generic_name(name):
                return NameResolution(
                    name, "medium", "footer_legal", page.url, f"footer: {footer[:120]}"
                )

    if homepage is not None and homepage.title and not _ERROR_TITLE_RE.search(homepage.title):
        cleaned = _clean_title(homepage.title)
        if cleaned and not is_generic_name(cleaned):
            return NameResolution(
                cleaned, "medium", "homepage_title", homepage.url, f"title: {homepage.title[:120]}"
            )

    fallback = _clean_title(fallback_title) if fallback_title else ""
    return NameResolution(
        fallback or (fallback_title or "Unknown business"),
        "low",
        "search_title",
        None,
        f"search result title: {fallback_title!r}",
    )
