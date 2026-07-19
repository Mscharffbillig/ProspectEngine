"""DOM-aware page metadata extracted at crawl time, while HTML is in memory.

Only small structured artifacts are kept (stored in website_pages.extraction_meta);
full HTML is never persisted. Downstream identity/person extraction works from
these artifacts plus the cleaned text.
"""

import json
import re
from typing import Any

from bs4 import BeautifulSoup, Tag

_ORG_TYPES = {
    "organization",
    "localbusiness",
    "homeandconstructionbusiness",
    "hvacbusiness",
    "plumber",
    "electrician",
    "generalcontractor",
    "roofingcontractor",
    "movingcompany",
    "professionalservice",
    "store",
    "housepainter",
    "locksmith",
}

_TEAM_SECTION_RE = re.compile(r"team|staff|leadership|management|member|crew|people", re.I)
_TEAM_HEADING_RE = re.compile(
    r"\b(?:our team|meet the|leadership|management team|our staff|owners?)\b", re.I
)


def _types_of(node: dict) -> set[str]:
    raw = node.get("@type", [])
    if isinstance(raw, str):
        raw = [raw]
    return {str(t).lower() for t in raw if isinstance(t, str)}


def _walk_json_ld(node: Any, orgs: list[dict], persons: list[dict]) -> None:
    if isinstance(node, list):
        for item in node:
            _walk_json_ld(item, orgs, persons)
        return
    if not isinstance(node, dict):
        return
    types = _types_of(node)
    if types & _ORG_TYPES and isinstance(node.get("name"), str):
        orgs.append({"name": node["name"].strip(), "types": sorted(types)})
    if "person" in types and isinstance(node.get("name"), str):
        persons.append(
            {
                "name": node["name"].strip(),
                "job_title": (node.get("jobTitle") or "").strip()
                if isinstance(node.get("jobTitle"), str)
                else "",
            }
        )
    for key in ("@graph", "member", "employee", "founder", "employees", "members"):
        if key in node:
            _walk_json_ld(node[key], orgs, persons)


def _clean(text: str, limit: int = 120) -> str:
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _team_members_from(soup: BeautifulSoup) -> list[dict]:
    members: list[dict] = []
    seen: set[str] = set()

    def add(name: str, role: str, context: str) -> None:
        name, role = _clean(name, 80), _clean(role, 80)
        if name and name.lower() not in seen:
            seen.add(name.lower())
            members.append({"name": name, "role": role, "context": _clean(context, 160)})

    # Explicit member cards: class/id mentioning team/staff/member.
    for el in soup.find_all(attrs={"class": _TEAM_SECTION_RE}):
        if not isinstance(el, Tag):
            continue
        heading = el.find(["h2", "h3", "h4", "h5", "strong"])
        if heading is None:
            continue
        role_el = el.find(class_=re.compile(r"title|role|position", re.I)) or heading.find_next(
            ["p", "span"]
        )
        add(
            heading.get_text(strip=True),
            role_el.get_text(strip=True) if role_el else "",
            el.get_text(" ", strip=True),
        )

    # Sections introduced by a team-ish heading: pair each sub-heading with the
    # short line that follows it.
    for heading in soup.find_all(["h1", "h2"], string=_TEAM_HEADING_RE):
        for sub in heading.find_all_next(["h3", "h4"], limit=8):
            nxt = sub.find_next(["p", "span"])
            add(
                sub.get_text(strip=True),
                nxt.get_text(strip=True) if nxt else "",
                f"{heading.get_text(strip=True)}: {sub.get_text(strip=True)}",
            )
    return members[:20]


def extract_meta(soup: BeautifulSoup) -> dict:
    """Structured identity/person artifacts for one page."""
    orgs: list[dict] = []
    persons: list[dict] = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            _walk_json_ld(json.loads(script.string or ""), orgs, persons)
        except (json.JSONDecodeError, TypeError):
            continue

    og = soup.find("meta", property="og:site_name")
    og_site_name = _clean(og.get("content", "")) if isinstance(og, Tag) else ""

    header_brand = ""
    logo_alt = ""
    header = soup.find("header")
    if isinstance(header, Tag):
        brand = header.find("a", class_=re.compile(r"brand|logo|site-title|navbar-brand", re.I))
        if isinstance(brand, Tag):
            header_brand = _clean(brand.get_text(strip=True), 80)
            img = brand.find("img")
            if isinstance(img, Tag):
                logo_alt = _clean(str(img.get("alt") or ""), 80)
        if not logo_alt:
            img = header.find("img", alt=True)
            if isinstance(img, Tag):
                logo_alt = _clean(str(img.get("alt") or ""), 80)
        if not header_brand:
            # Fallback: only a link pointing at the site root counts as a brand
            # (nav items like "About" also live in the header).
            for link in header.find_all("a", href=True):
                if str(link.get("href", "")).rstrip("/") in ("", "."):
                    header_brand = _clean(link.get_text(strip=True), 80)
                    break

    footer = soup.find_all("footer")
    footer_text = _clean(footer[-1].get_text(" ", strip=True), 300) if footer else ""

    nav_labels: list[str] = []
    for nav in soup.find_all(["nav", "header", "footer"]):
        if isinstance(nav, Tag):
            for a in nav.find_all("a"):
                label = _clean(a.get_text(strip=True), 60)
                if label:
                    nav_labels.append(label.lower())

    headings = [
        _clean(h.get_text(strip=True), 100).lower()
        for h in soup.find_all(["h1", "h2", "h3"])
        if h.get_text(strip=True)
    ]

    return {
        "json_ld_orgs": orgs[:5],
        "json_ld_persons": persons[:10],
        "og_site_name": og_site_name,
        "header_brand": header_brand,
        "logo_alt": logo_alt,
        "footer_text": footer_text,
        "nav_labels": sorted(set(nav_labels))[:40],
        "headings": headings[:25],
        "team_members": _team_members_from(soup),
    }
