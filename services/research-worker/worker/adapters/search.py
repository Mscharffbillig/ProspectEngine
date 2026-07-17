"""Discovery source adapters behind a shared interface.

Implemented: Brave Search API (live) and fixture-backed search (demo mode).
Additional adapters (OSM Overpass, directory/licensing data) implement the
same SearchAdapter protocol.
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx

from worker.config import FIXTURES_DIR, settings

log = logging.getLogger(__name__)

# Aggregators/directories that are not the business's own site.
AGGREGATOR_DOMAINS = {
    "yelp.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "angi.com",
    "yellowpages.com",
    "bbb.org",
    "homeadvisor.com",
    "thumbtack.com",
    "houzz.com",
    "mapquest.com",
    "manta.com",
    "porch.com",
    "nextdoor.com",
    "wikipedia.org",
    "indeed.com",
    "glassdoor.com",
    "google.com",
    "reddit.com",
    "buildzoom.com",
    "chamberofcommerce.com",
    "dnb.com",
    "zoominfo.com",
}


@dataclass
class SearchResult:
    query: str
    title: str
    url: str
    snippet: str
    rank: int


class SearchAdapter(Protocol):
    def search(self, query: str, count: int = 20) -> list[SearchResult]: ...


def generate_queries(industries: list[str], locations: list[str]) -> list[str]:
    """Cross industries x locations into discovery queries."""
    queries = []
    for industry in industries:
        for location in locations:
            queries.append(f"{industry} company {location}")
            queries.append(f"{industry} contractor {location}")
    return queries


class BraveSearchAdapter:
    """Brave Search API adapter with basic rate limiting and retry."""

    ENDPOINT = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str, requests_per_second: float = 0.9) -> None:
        if not api_key:
            raise ValueError("BRAVE_SEARCH_API_KEY is not configured")
        self._client = httpx.Client(
            headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
            timeout=20,
        )
        self._min_interval = 1.0 / requests_per_second
        self._last_request = 0.0

    def search(self, query: str, count: int = 20) -> list[SearchResult]:
        for attempt in range(3):
            self._throttle()
            try:
                response = self._client.get(
                    self.ENDPOINT, params={"q": query, "count": min(count, 20)}
                )
            except httpx.HTTPError as exc:
                log.warning("brave search transport error (attempt %d): %s", attempt + 1, exc)
                time.sleep(2**attempt)
                continue
            if response.status_code == 429:
                log.warning("brave search rate limited; backing off")
                time.sleep(5 * (attempt + 1))
                continue
            if response.status_code == 401:
                raise RuntimeError("Brave Search API key rejected (401)")
            if response.status_code >= 500:
                time.sleep(2**attempt)
                continue
            response.raise_for_status()
            return self._parse(query, response.json())
        raise RuntimeError(f"Brave search failed after retries for query: {query}")

    def _parse(self, query: str, payload: dict) -> list[SearchResult]:
        results = []
        web_results = (payload.get("web") or {}).get("results") or []
        for rank, item in enumerate(web_results, start=1):
            url = item.get("url")
            if not url:
                continue
            results.append(
                SearchResult(
                    query=query,
                    title=item.get("title") or "",
                    url=url,
                    snippet=item.get("description") or "",
                    rank=rank,
                )
            )
        return results

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request = time.monotonic()


class FixtureSearchAdapter:
    """Reads saved search results from fixtures/search-results/*.json (demo mode)."""

    def __init__(self, fixtures_dir: Path = FIXTURES_DIR) -> None:
        self.dir = fixtures_dir / "search-results"

    def search(self, query: str, count: int = 20) -> list[SearchResult]:
        slug = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")
        path = self.dir / f"{slug}.json"
        if not path.exists():
            log.info("no search fixture for query %r (looked for %s)", query, path.name)
            return []
        items = json.loads(path.read_text(encoding="utf-8"))
        return [
            SearchResult(
                query=query,
                title=item["title"],
                url=item["url"],
                snippet=item.get("snippet", ""),
                rank=i + 1,
            )
            for i, item in enumerate(items[:count])
        ]


def make_search_adapter() -> SearchAdapter:
    if settings.demo_mode:
        return FixtureSearchAdapter()
    return BraveSearchAdapter(settings.brave_search_api_key)


def is_aggregator(domain: str | None) -> bool:
    if not domain:
        return True
    return any(domain == agg or domain.endswith("." + agg) for agg in AGGREGATOR_DOMAINS)
