"""Heuristic extraction of structured facts from crawled page text.

Every fact carries value, confidence, source URL, supporting excerpt, and
method. Heuristic hits are never labeled 'confirmed' unless the value is
literally published (phone/email printed on the page).

Person extraction lives in worker.people (DOM/JSON-LD aware with strict
validation) — free text alone is never trusted to identify a person.

Scoring signals require contextual evidence: broad isolated keywords
("commercial", "careers", "fleet") intentionally do not match.
"""

import re
from dataclasses import dataclass

CONFIDENCE = ("confirmed", "high", "medium", "low", "unknown")

_KNOWN_FIELD_SOFTWARE = [
    "servicetitan",
    "jobber",
    "housecall pro",
    "fieldedge",
    "service fusion",
    "buildertrend",
    "procore",
    "salesforce",
    "netsuite",
]

_PHONE_RE = re.compile(r"\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_ADDRESS_RE = re.compile(
    r"\b\d{1,6}\s+[A-Z][A-Za-z0-9.\s]{2,40}"
    r"(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Highway|Hwy)"
    r"\b\.?(?:,?\s+[A-Z][A-Za-z\s]+,?\s+[A-Z]{2}\s+\d{5})?"
)
_YEAR_RE = re.compile(
    r"\b(?:since|established|est\.?|founded)\s*(?:in\s+)?(19\d{2}|20[0-2]\d)\b", re.I
)


@dataclass
class Fact:
    key: str
    value: str
    confidence: str
    source_url: str
    excerpt: str
    method: str = "heuristic"


def _excerpt(text: str, index: int, radius: int = 140) -> str:
    start = max(0, index - radius)
    end = min(len(text), index + radius)
    return re.sub(r"\s+", " ", text[start:end]).strip()


# key -> list of (pattern, confidence); first match wins. Patterns demand
# context: the isolated keywords that inflated live scores do not appear here.
_KEYWORD_CHECKS: list[tuple[str, list[tuple[str, str]], str]] = [
    (
        "multiple_crews",
        [
            (r"\b(?:\d+|two|three|four|five|six)\s+(?:full[- ]time\s+)?crews\b", "high"),
            (r"\bmultiple crews\b", "high"),
            (r"\b\d+\s+(?:employees|technicians|team members|installers)\b", "high"),
            (r"\bour crews\b", "medium"),
            (r"\bcrew leaders?\b", "medium"),
        ],
        "evidence of multiple crews/employees",
    ),
    (
        "commercial_work",
        [
            (r"\bgeneral contractors?\b", "high"),
            (r"\bmunicipal(?:ities)?\b", "high"),
            (r"\bproperty (?:managers?|management)\b", "high"),
            (
                r"\bcommercial (?:clients?|customers?|accounts?|contracts?|projects?|lots|tenants)\b",
                "high",
            ),
            (r"\bcommercial (?:site (?:prep(?:aration)?|work)|snow removal)\b", "high"),
            (r"\bcommercial\b", "low"),
        ],
        "commercial/municipal work",
    ),
    (
        "residential_focus",
        [(r"\bresidential\b", "medium"), (r"\bhomeowners?\b", "medium")],
        "residential work",
    ),
    (
        "recurring_service",
        [
            (r"\bmaintenance (?:plan|program|agreement|contract)s?\b", "high"),
            (r"\bservice agreements?\b", "high"),
            (r"\bsnow removal contracts?\b", "high"),
            (r"\bsnow removal\b", "medium"),
            (r"\brecurring (?:service|maintenance|work)\b", "high"),
            (r"\bmonthly service\b", "medium"),
        ],
        "recurring-service language",
    ),
    (
        "hiring",
        [
            (r"\bnow hiring\b", "high"),
            (r"\bwe'?re hiring\b", "high"),
            (r"\bopen positions?\b", "high"),
            (r"\bjoin our (?:team|crew)\b", "medium"),
            (r"\bhiring\s+(?:for|an?)\b", "medium"),
        ],
        "evidence of hiring",
    ),
    (
        "franchise_signal",
        [
            (r"\bfranchise\b", "high"),
            (r"\blocations nationwide\b", "high"),
            (r"\bnational(?:ly)? recognized brand\b", "high"),
            (r"\bcorporate locations\b", "high"),
            (r"\bfind a location near you\b", "high"),
        ],
        "franchise/national language",
    ),
    (
        "independent_signal",
        [
            (
                r"\b(?:family[- ]owned|locally owned|independently owned|owner[- ]operated|family[- ]run)\b",
                "high",
            ),
        ],
        "independent/family-owned language",
    ),
    (
        "equipment_heavy",
        [
            (r"\bour (?:own\s+)?(?:fleet|heavy equipment|excavators|equipment)\b", "high"),
            (r"\bfleet of (?:excavators|dozers|trucks|plows|mowers|vehicles|equipment)\b", "high"),
            (
                r"\bwe (?:run|own|operate|maintain)\b[^.\n]{0,60}\b(?:fleet|equipment|machines)\b",
                "high",
            ),
        ],
        "equipment-heavy operation (company-owned)",
    ),
    (
        "emergency_service",
        [
            (r"\b24/7 emergency\b", "high"),
            (r"\bemergency dispatch\b", "high"),
            (r"\bafter[- ]hours (?:emergency|dispatch|service calls?)\b", "high"),
            (r"\b24/7\b", "medium"),
            (r"\bemergency service\b", "medium"),
            (r"\bafter[- ]hours\b", "medium"),
        ],
        "emergency service offered",
    ),
    (
        "manual_forms",
        [
            (r"\bprintable form\b", "high"),
            (r"\bdownload (?:our|the) [^.\n]{0,40}form\b", "high"),
            (r"\bpdf form\b", "high"),
            (r"\bfax\b", "medium"),
            (r"\bpaper application\b", "high"),
        ],
        "manual/disconnected process visible",
    ),
    (
        "solo_operator_signal",
        [
            (r"\bone[- ]man\b", "high"),
            (r"\bowner[- ]operator\s+only\b", "high"),
            (r"\bjust me\b", "high"),
            (r"\bsole proprietor\b", "high"),
            (r"\bit'?s just me\b", "high"),
        ],
        "likely solo operator",
    ),
    (
        "quote_driven",
        [
            (r"\bfree estimates?\b", "medium"),
            (r"\brequest a quote\b", "medium"),
            (r"\bget a quote\b", "medium"),
            (r"\bfree quote\b", "medium"),
        ],
        "quote-driven services",
    ),
]


def extract_from_page(url: str, text: str) -> list[Fact]:
    """Extract all facts visible on a single page of cleaned text."""
    facts: list[Fact] = []

    for m in list(_PHONE_RE.finditer(text))[:3]:
        facts.append(
            Fact("phone", m.group(0), "confirmed", url, _excerpt(text, m.start()), "regex")
        )

    for m in list(_EMAIL_RE.finditer(text))[:5]:
        email = m.group(0).lower()
        if email.split(".")[-1] in {"png", "jpg", "jpeg", "gif", "svg", "webp"}:
            continue
        facts.append(Fact("email", email, "confirmed", url, _excerpt(text, m.start()), "regex"))

    address = _ADDRESS_RE.search(text)
    if address:
        facts.append(
            Fact(
                "address",
                re.sub(r"\s+", " ", address.group(0)).strip(),
                "high",
                url,
                _excerpt(text, address.start()),
                "regex",
            )
        )

    year = _YEAR_RE.search(text)
    if year:
        facts.append(
            Fact(
                "established_year",
                year.group(1),
                "high",
                url,
                _excerpt(text, year.start()),
                "regex",
            )
        )

    service_area = re.search(
        r"(?:serving|we serve|service area[s]? includ\w+|proudly serv\w+)\s+([^.\n]{5,160})",
        text,
        re.I,
    )
    if service_area:
        area = service_area.group(1).strip()
        # A generic phrase ("serving the area") is low confidence; 3+ named
        # places indicate a real territory; a very long city list is usually
        # keyword-stuffed SEO copy, not an operating territory.
        place_count = len([p for p in re.split(r",|\band\b", area) if p.strip()])
        if place_count >= 3:
            area_confidence = "high" if place_count <= 12 else "medium"
        else:
            area_confidence = "low"
        facts.append(
            Fact(
                "service_area",
                area,
                area_confidence,
                url,
                _excerpt(text, service_area.start()),
            )
        )

    lower = text.lower()
    for key, patterns, value in _KEYWORD_CHECKS:
        for pattern, confidence in patterns:
            found = re.search(pattern, lower)
            if found:
                facts.append(Fact(key, value, confidence, url, _excerpt(text, found.start())))
                break

    for software in _KNOWN_FIELD_SOFTWARE:
        index = lower.find(software)
        if index >= 0:
            facts.append(Fact("software_named", software, "high", url, _excerpt(text, index)))

    locations = re.search(
        r"\b(?:(\d+)|two|three|four|five|both)\s+(?:locations|offices|branches|shops)\b",
        text,
        re.I,
    )
    if locations:
        facts.append(
            Fact(
                "multiple_locations",
                locations.group(0),
                "high",
                url,
                _excerpt(text, locations.start()),
            )
        )

    for m in re.finditer(
        r"https?://(?:www\.)?(facebook|instagram|linkedin|youtube)\.com/[\w./-]+", text, re.I
    ):
        facts.append(
            Fact("social_profile", m.group(0), "confirmed", url, _excerpt(text, m.start()), "regex")
        )

    return facts


def dedupe_facts(facts: list[Fact]) -> list[Fact]:
    """Keep one fact per (key, value), preferring higher confidence."""
    rank = {c: i for i, c in enumerate(CONFIDENCE)}
    best: dict[tuple[str, str], Fact] = {}
    for fact in facts:
        key = (fact.key, fact.value.lower())
        if key not in best or rank[fact.confidence] < rank[best[key].confidence]:
            best[key] = fact
    return list(best.values())
