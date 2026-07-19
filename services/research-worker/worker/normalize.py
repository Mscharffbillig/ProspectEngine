"""Normalization for company names, domains, URLs, phones, and locations.

This is the single implementation of normalization logic; the web app never
re-implements it (CSV imports are processed here too).
"""

import re
from urllib.parse import urlparse

# Legal / generic suffixes stripped from company names for matching.
_NAME_SUFFIXES = {
    "llc",
    "l.l.c",
    "inc",
    "inc.",
    "incorporated",
    "company",
    "co",
    "co.",
    "corporation",
    "corp",
    "corp.",
    "ltd",
    "ltd.",
    "llp",
    "lp",
    "pllc",
    "pc",
}

_STATE_ABBREVIATIONS = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}


def normalize_company_name(name: str) -> str:
    """Lowercase, strip punctuation and legal suffixes: 'Acme Excavating, LLC' -> 'acme excavating'."""
    cleaned = name.lower().replace(".", "")  # keep "L.L.C." -> "llc" as one token
    cleaned = re.sub(r"[^\w\s&']", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    words = cleaned.split(" ")
    while words and words[-1] in _NAME_SUFFIXES:
        words.pop()
    return " ".join(words)


def normalize_url(url: str) -> str | None:
    """Canonicalize a URL: force scheme, lowercase host, drop fragments and tracking params."""
    url = url.strip()
    if not url:
        return None
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if not host or "." not in host:
        return None
    path = re.sub(r"/+$", "", parsed.path) or ""
    return f"{parsed.scheme.lower()}://{host}{path}"


def normalize_domain(url_or_domain: str) -> str | None:
    """Extract the registered host, dropping 'www.': 'https://www.Acme.com/x' -> 'acme.com'."""
    normalized = normalize_url(url_or_domain)
    if normalized is None:
        return None
    host = urlparse(normalized).hostname or ""
    return host.removeprefix("www.") or None


def normalize_phone(phone: str) -> str | None:
    """Reduce a US/CA phone number to 10 digits; None if it isn't one."""
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def normalize_city(city: str) -> str:
    return re.sub(r"\s+", " ", city.strip()).title()


def normalize_state(state: str) -> str:
    """Return the two-letter state code when recognizable, else trimmed input."""
    cleaned = state.strip()
    if len(cleaned) == 2:
        return cleaned.upper()
    return _STATE_ABBREVIATIONS.get(cleaned.lower(), cleaned)


# Street/unit words that precede the city in comma-less addresses
# ("1234 Plymouth Avenue N Minneapolis, MN 55412").
_STREET_TAIL_WORDS = {
    "st",
    "street",
    "ave",
    "avenue",
    "rd",
    "road",
    "blvd",
    "boulevard",
    "dr",
    "drive",
    "ln",
    "lane",
    "way",
    "ct",
    "court",
    "hwy",
    "highway",
    "n",
    "s",
    "e",
    "w",
    "ne",
    "nw",
    "se",
    "sw",
    "suite",
    "ste",
    "unit",
}


def _city_from_tail(text: str) -> str | None:
    """Walk back from the state, keeping words until a street/unit word or
    number appears ('Main St Suite A Eagan' -> 'Eagan')."""
    city_words: list[str] = []
    for word in reversed(text.split()):
        cleaned = word.lower().rstrip(".,#")
        if cleaned in _STREET_TAIL_WORDS or any(ch.isdigit() for ch in word) or len(cleaned) <= 1:
            break
        city_words.insert(0, word)
    return " ".join(city_words[-3:]) if city_words else None


def parse_city_state(address: str) -> tuple[str, str] | None:
    """Pull (city, state) from a US address ending in 'City, ST 55807'."""
    # Preferred: fully comma-separated "..., City, ST 55807".
    match = re.search(r",\s*([A-Za-z .'-]{2,40}),\s*([A-Z]{2})\s+\d{5}", address)
    if match:
        captured = match.group(1)
        tokens = {w.lower().rstrip(".,#") for w in captured.split()}
        # "Suite A Eagan" style: street/unit words leaked into the capture.
        # "st"/"ste" excluded from the trigger so "St. Cloud" stays intact.
        if tokens & (_STREET_TAIL_WORDS - {"st", "ste"}) or any(ch.isdigit() for ch in captured):
            city = _city_from_tail(captured)
            return (normalize_city(city), match.group(2)) if city else None
        return normalize_city(captured), match.group(2)
    # Fallback: "... Street City, ST 55807" with no comma before the city.
    match = re.search(r"([A-Za-z .'-]{2,60}),\s*([A-Z]{2})\s+\d{5}", address)
    if not match:
        return None
    city = _city_from_tail(match.group(1))
    return (normalize_city(city), match.group(2)) if city else None


def normalize_address(address: str) -> str:
    """Light address normalization for matching: collapse whitespace, lowercase, expand nothing."""
    return re.sub(r"\s+", " ", address.strip().lower()).rstrip(".,")
