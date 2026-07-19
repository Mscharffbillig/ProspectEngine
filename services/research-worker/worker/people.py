"""Safe person/decision-maker extraction.

Priority: JSON-LD Person > DOM team sections > strict single-line text
patterns. Every candidate must pass name validation; navigation labels and
repeated site headings are rejected outright. Only high/confirmed-confidence
people are decision-maker eligible.
"""

import re
from dataclasses import dataclass

from worker.crawler import FetchedPage

ROLE_TYPES = {
    "owner": "owner",
    "co-owner": "owner",
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

DECISION_MAKER_TYPES = {
    "owner",
    "founder",
    "general_manager",
    "operations_manager",
    "office_manager",
    "service_manager",
    "project_manager",
}

# Generic/navigation/business words that can never be part of a person's name.
_NAME_STOP_WORDS = {
    "customer",
    "customers",
    "reviews",
    "review",
    "home",
    "homes",
    "job",
    "jobs",
    "type",
    "types",
    "team",
    "teams",
    "meet",
    "insured",
    "shop",
    "mechanics",
    "mechanic",
    "equipment",
    "services",
    "service",
    "contact",
    "about",
    "company",
    "commercial",
    "residential",
    "projects",
    "project",
    "careers",
    "career",
    "employment",
    "location",
    "locations",
    "staff",
    "leadership",
    "management",
    "licensed",
    "fully",
    "free",
    "estimate",
    "estimates",
    "quote",
    "quotes",
    "apply",
    "hiring",
    "financing",
    "available",
    "gallery",
    "testimonials",
    "faq",
    "blog",
    "news",
    "portal",
    "login",
    "menu",
    "our",
    "the",
    "and",
    "llc",
    "inc",
    "hvac",
    "heating",
    "cooling",
    "plumbing",
    "excavating",
    "excavation",
    "landscaping",
    "cleaning",
    "restoration",
    "repair",
    "welcome",
    "owner",
    "owners",
    "manager",
    "operators",
    "operator",
    "call",
    "text",
    "phone",
    "email",
}

_NAME_TOKEN_RE = re.compile(r"^[A-Z][a-zA-Z'’.-]+$")
_ROLE_WORDS_RE = (
    r"(?i:owner|co-owner|founder|co-founder|president|general manager|"
    r"operations manager|director of operations|office manager|"
    r"service manager|project manager)"
)
_NAME_RE = r"[A-Z][a-z'’.-]+(?: [A-Z][a-zA-Z'’.-]+){1,2}"

# Strict single-line patterns only ("John Smith, Owner" / "Owner: John Smith" /
# "John Smith — Operations Manager" / "John Smith serves as Operations Manager").
_TEXT_PATTERNS = [
    re.compile(rf"\b({_NAME_RE}),\s+(?:the\s+|our\s+)?({_ROLE_WORDS_RE})\b"),
    re.compile(rf"\b({_ROLE_WORDS_RE})\s*[:—–-]\s*({_NAME_RE})\b"),
    re.compile(rf"\b({_NAME_RE})\s+[—–-]\s+({_ROLE_WORDS_RE})\b"),
    re.compile(rf"\b({_NAME_RE})\s+serves as\s+(?:the\s+|our\s+)?({_ROLE_WORDS_RE})\b"),
    re.compile(rf"\b({_ROLE_WORDS_RE})\s+({_NAME_RE})\b(?=\s+(?:founded|started|leads|runs|has))"),
]

_ABOUT_PAGE_RE = re.compile(r"about|team|staff|leadership|owner|management", re.I)

CONFIDENCE_RANK = {"confirmed": 4, "high": 3, "medium": 2, "low": 1, "unknown": 0}


@dataclass
class Person:
    name: str
    role: str
    role_type: str
    confidence: str  # confirmed | high | medium | low
    source_url: str
    excerpt: str
    method: str  # json_ld | dom_team | text_pattern

    @property
    def decision_maker_eligible(self) -> bool:
        return (
            self.role_type in DECISION_MAKER_TYPES
            and CONFIDENCE_RANK[self.confidence] >= CONFIDENCE_RANK["high"]
        )


def is_valid_person_name(name: str, site_chrome: set[str]) -> bool:
    """Reject navigation labels, headings, business phrases, and non-names."""
    name = name.strip()
    if not name or "\n" in name:
        return False
    if re.search(r"[@\d]|https?://", name):
        return False
    if name.isupper():
        return False
    tokens = name.split()
    if not 2 <= len(tokens) <= 3:
        return False
    for token in tokens:
        if not _NAME_TOKEN_RE.match(token):
            return False
        if token.lower().strip(".,'’-") in _NAME_STOP_WORDS:
            return False
    return name.lower() not in site_chrome


def _role_type_of(role: str) -> str:
    role_l = role.lower().strip(" .,-—–")
    for key, value in ROLE_TYPES.items():
        if key in role_l:
            return value
    return "other"


def _site_chrome(pages: list[FetchedPage]) -> set[str]:
    """Navigation labels and repeated headings across the site."""
    chrome: set[str] = set()
    heading_counts: dict[str, int] = {}
    for page in pages:
        chrome.update(page.meta.get("nav_labels", []))
        for heading in page.meta.get("headings", []):
            heading_counts[heading] = heading_counts.get(heading, 0) + 1
    chrome.update(h for h, n in heading_counts.items() if n > 1)
    return chrome


def extract_people(pages: list[FetchedPage]) -> list[Person]:
    chrome = _site_chrome(pages)
    best: dict[str, Person] = {}

    def add(person: Person) -> None:
        key = person.name.lower()
        current = best.get(key)
        if (
            current is None
            or CONFIDENCE_RANK[person.confidence] > CONFIDENCE_RANK[current.confidence]
        ):
            best[key] = person

    for page in pages:
        # 1. JSON-LD Person entries with a job title.
        for entry in page.meta.get("json_ld_persons", []):
            name, role = entry.get("name", ""), entry.get("job_title", "")
            if role and is_valid_person_name(name, chrome):
                add(
                    Person(
                        name,
                        role,
                        _role_type_of(role),
                        "confirmed",
                        page.url,
                        f"JSON-LD Person: {name} ({role})",
                        "json_ld",
                    )
                )

        # 2. DOM team/staff/leadership sections.
        for member in page.meta.get("team_members", []):
            name, role = member.get("name", ""), member.get("role", "")
            role_type = _role_type_of(role)
            if role and role_type != "other" and is_valid_person_name(name, chrome):
                add(
                    Person(
                        name,
                        role,
                        role_type,
                        "high",
                        page.url,
                        member.get("context", f"{name} — {role}"),
                        "dom_team",
                    )
                )

    # 3. Strict single-line text patterns (never across line breaks).
    for page in pages:
        page_confidence = (
            "high"
            if _ABOUT_PAGE_RE.search(page.url) or _ABOUT_PAGE_RE.search(page.title or "")
            else "medium"
        )
        for line in page.text.split("\n"):
            for pattern in _TEXT_PATTERNS:
                for match in pattern.finditer(line):
                    a, b = match.group(1), match.group(2)
                    name, role = (b, a) if _role_type_of(a) != "other" else (a, b)
                    if _role_type_of(role) == "other":
                        continue
                    if not is_valid_person_name(name, chrome):
                        continue
                    add(
                        Person(
                            name.strip(),
                            role.strip(),
                            _role_type_of(role),
                            page_confidence,
                            page.url,
                            line.strip()[:200],
                            "text_pattern",
                        )
                    )

    return list(best.values())
