"""Weighted-signal duplicate detection between a candidate and existing businesses.

Signals (strongest first):
  1. exact normalized domain match        -> definite duplicate
  2. exact normalized phone match         -> definite duplicate
  3. strong name match + same city        -> definite duplicate
  4. matching normalized address          -> definite duplicate
  5. two or more weaker signals           -> duplicate

Merging never deletes evidence: source records are re-pointed at the surviving
business (done by the caller in SQL); this module only decides matches.
"""

from dataclasses import dataclass, field

from worker.normalize import (
    normalize_address,
    normalize_city,
    normalize_company_name,
)

MATCH_THRESHOLD = 100  # any single strong signal reaches this alone


@dataclass
class CandidateRecord:
    """Pre-normalized fields used for matching."""

    name: str = ""
    domain: str | None = None
    phone: str | None = None
    city: str | None = None
    address: str | None = None
    id: str | None = None


@dataclass
class MatchResult:
    is_duplicate: bool
    score: int
    signals: list[str] = field(default_factory=list)


def _name_similarity(a: str, b: str) -> float:
    """Token-overlap similarity between normalized names (0..1)."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    overlap = len(ta & tb)
    return overlap / max(len(ta), len(tb))


def match(candidate: CandidateRecord, existing: CandidateRecord) -> MatchResult:
    score = 0
    signals: list[str] = []

    if candidate.domain and existing.domain and candidate.domain == existing.domain:
        score += 100
        signals.append("domain_exact")

    if candidate.phone and existing.phone and candidate.phone == existing.phone:
        score += 100
        signals.append("phone_exact")

    name_a = normalize_company_name(candidate.name) if candidate.name else ""
    name_b = normalize_company_name(existing.name) if existing.name else ""
    similarity = _name_similarity(name_a, name_b)
    same_city = bool(
        candidate.city
        and existing.city
        and normalize_city(candidate.city) == normalize_city(existing.city)
    )

    if similarity >= 0.8 and same_city:
        score += 100
        signals.append("name_city_strong")
    elif similarity >= 0.8:
        score += 50
        signals.append("name_strong")
    elif similarity >= 0.5:
        score += 30
        signals.append("name_partial")

    if same_city and "name_city_strong" not in signals:
        score += 20
        signals.append("city_match")

    if (
        candidate.address
        and existing.address
        and normalize_address(candidate.address) == normalize_address(existing.address)
    ):
        score += 100
        signals.append("address_exact")

    return MatchResult(is_duplicate=score >= MATCH_THRESHOLD, score=score, signals=signals)


def find_duplicate(
    candidate: CandidateRecord, existing: list[CandidateRecord]
) -> tuple[CandidateRecord, MatchResult] | None:
    """Return the best duplicate match among existing records, if any."""
    best: tuple[CandidateRecord, MatchResult] | None = None
    for record in existing:
        result = match(candidate, record)
        if result.is_duplicate and (best is None or result.score > best[1].score):
            best = (record, result)
    return best
