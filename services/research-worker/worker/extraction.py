"""Heuristic extraction of structured facts from crawled page text.

Every fact carries value, confidence, source URL, supporting excerpt, and
method. Heuristic hits are never labeled 'confirmed' unless the value is
literally published (phone/email printed on the page).
"""

import re
from dataclasses import dataclass

CONFIDENCE = ("confirmed", "high", "medium", "low", "unknown")

ROLE_TYPES = {
    "owner": "owner",
    "founder": "founder",
    "co-founder": "founder",
    "president": "owner",
    "general manager": "general_manager",
    "operations manager": "operations_manager",
    "director of operations": "operations_manager",
    "office manager": "office_manager",
    "service manager": "service_manager",
    "project manager": "project_manager",
}

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
# Names must be strictly capitalized; only the role words are case-insensitive.
_ROLE_WORDS = (
    r"(?i:owner|founder|co-founder|president|general manager|operations manager|"
    r"director of operations|office manager|service manager|project manager)"
)
_NAME_ROLE_RE = re.compile(
    r"\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\s*(?:,|-|–|—|\bis\b|\bour\b|\bserves\s+as\b)?\s*"
    r"(?i:the\s+|our\s+)?(" + _ROLE_WORDS + r")"
)
_ROLE_NAME_RE = re.compile(
    r"\b(" + _ROLE_WORDS + r")\s*[:,]?\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})"
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


def _keyword_fact(
    text: str, url: str, key: str, patterns: list[str], value: str, confidence: str = "medium"
) -> Fact | None:
    lower = text.lower()
    for pattern in patterns:
        found = re.search(pattern, lower)
        if found:
            return Fact(key, value, confidence, url, _excerpt(text, found.start()))
    return None


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

    seen_people: set[str] = set()
    for m in _NAME_ROLE_RE.finditer(text):
        name, role = m.group(1), m.group(2).lower()
        if name.lower() in seen_people:
            continue
        seen_people.add(name.lower())
        facts.append(
            Fact("person_role", f"{name}|{role}", "high", url, _excerpt(text, m.start()), "regex")
        )
    for m in _ROLE_NAME_RE.finditer(text):
        role, name = m.group(1).lower(), m.group(2)
        if name.lower() in seen_people:
            continue
        seen_people.add(name.lower())
        facts.append(
            Fact("person_role", f"{name}|{role}", "high", url, _excerpt(text, m.start()), "regex")
        )

    service_area = re.search(
        r"(?:serving|we serve|service area[s]? includ\w+|proudly serv\w+)\s+([^.\n]{5,160})",
        text,
        re.I,
    )
    if service_area:
        facts.append(
            Fact(
                "service_area",
                service_area.group(1).strip(),
                "medium",
                url,
                _excerpt(text, service_area.start()),
            )
        )

    keyword_checks: list[tuple[str, list[str], str, str]] = [
        (
            "multiple_crews",
            [
                r"\bour crews\b",
                r"\bmultiple crews\b",
                r"\b\d+\s+crews\b",
                r"\bour teams\b",
                r"\bcrew leaders?\b",
                r"\bour technicians\b",
                r"\b\d+\s+(?:employees|technicians|team members)\b",
            ],
            "evidence of multiple crews/employees",
            "medium",
        ),
        (
            "commercial_work",
            [
                r"\bcommercial\b",
                r"\bmunicipal\b",
                r"\bgeneral contractors?\b",
                r"\bproperty manage\w+\b",
            ],
            "commercial/municipal work",
            "medium",
        ),
        (
            "residential_focus",
            [r"\bresidential\b", r"\bhomeowners?\b"],
            "residential work",
            "medium",
        ),
        (
            "recurring_service",
            [
                r"\bmaintenance (?:plan|program|agreement|contract)s?\b",
                r"\bweekly\b",
                r"\bmonthly service\b",
                r"\bseasonal\b",
                r"\bsnow removal\b",
                r"\brecurring\b",
            ],
            "recurring-service language",
            "medium",
        ),
        (
            "hiring",
            [
                r"\bnow hiring\b",
                r"\bwe'?re hiring\b",
                r"\bjoin our team\b",
                r"\bcareers?\b",
                r"\bopen positions?\b",
                r"\bapply (?:now|today)\b",
            ],
            "evidence of hiring",
            "medium",
        ),
        (
            "franchise_signal",
            [
                r"\bfranchise\b",
                r"\blocations nationwide\b",
                r"\bnational(?:ly)? recognized brand\b",
                r"\bcorporate locations\b",
                r"\bfind a location near you\b",
            ],
            "franchise/national language",
            "medium",
        ),
        (
            "independent_signal",
            [
                r"\b(?:family[- ]owned|locally owned|independently owned|owner[- ]operated|family[- ]run)\b"
            ],
            "independent/family-owned language",
            "medium",
        ),
        (
            "equipment_heavy",
            [
                r"\bfleet\b",
                r"\bexcavators?\b",
                r"\bskid steers?\b",
                r"\bdump trucks?\b",
                r"\bheavy equipment\b",
                r"\bmachinery\b",
                r"\btrucks and equipment\b",
            ],
            "equipment-heavy operation",
            "medium",
        ),
        (
            "emergency_service",
            [r"\b24/7\b", r"\bemergency service\b", r"\bafter[- ]hours\b"],
            "emergency service offered",
            "medium",
        ),
        (
            "manual_forms",
            [
                r"\bprintable form\b",
                r"\bdownload (?:our|the) form\b",
                r"\bfax\b",
                r"\bpdf form\b",
                r"\bcall or text\b",
                r"\btext us\b",
                r"\bcall (?:us|the office) to schedule\b",
            ],
            "manual/disconnected process visible",
            "medium",
        ),
        (
            "solo_operator_signal",
            [
                r"\bone[- ]man\b",
                r"\bowner[- ]operator\s+only\b",
                r"\bjust me\b",
                r"\bsole proprietor\b",
            ],
            "likely solo operator",
            "medium",
        ),
        (
            "quote_driven",
            [r"\bfree estimates?\b", r"\brequest a quote\b", r"\bget a quote\b", r"\bfree quote\b"],
            "quote-driven services",
            "medium",
        ),
    ]
    for key, patterns, value, confidence in keyword_checks:
        fact = _keyword_fact(text, url, key, patterns, value, confidence)
        if fact:
            facts.append(fact)

    lower = text.lower()
    for software in _KNOWN_FIELD_SOFTWARE:
        index = lower.find(software)
        if index >= 0:
            facts.append(Fact("software_named", software, "high", url, _excerpt(text, index)))

    locations = re.search(
        r"\b(?:(\d+)|two|three|four|five|both)\s+(?:locations|offices|branches|shops)\b", text, re.I
    )
    if locations:
        facts.append(
            Fact(
                "multiple_locations",
                locations.group(0),
                "medium",
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
