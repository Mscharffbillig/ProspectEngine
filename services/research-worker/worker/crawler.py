"""Polite website crawler: robots.txt aware, capped depth/pages, same-domain only.

In demo mode a FixtureFetcher serves saved HTML from /fixtures/sites/<domain>/
so the full pipeline runs without touching the network.
"""

import hashlib
import logging
import re
import time
import urllib.robotparser
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from worker.config import settings

log = logging.getLogger(__name__)

PRIORITY_PATHS = ["", "about", "services", "contact", "team", "careers", "locations"]
_PRIORITY_WORDS = [
    "about",
    "service",
    "contact",
    "team",
    "career",
    "location",
    "staff",
    "employment",
]
_SKIP_EXTENSIONS = re.compile(
    r"\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|ico|css|js|woff2?)$", re.I
)
_SKIP_PATH_WORDS = re.compile(
    r"(calendar|event|\?page=|\?date=|wp-json|feed|login|cart|checkout)", re.I
)


@dataclass
class FetchedPage:
    url: str
    title: str | None
    http_status: int | None
    text: str
    content_hash: str
    crawl_allowed: bool = True
    error: str | None = None
    links: list[str] = field(default_factory=list)


class Fetcher:
    """Live HTTP fetcher with robots.txt checks and size/time limits."""

    def __init__(self) -> None:
        self._client = httpx.Client(
            headers={"User-Agent": settings.user_agent},
            timeout=settings.crawl_timeout_seconds,
            follow_redirects=True,
        )
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}

    def allowed(self, url: str) -> bool:
        host = urlparse(url).netloc
        if host not in self._robots:
            parser = urllib.robotparser.RobotFileParser()
            robots_url = f"{urlparse(url).scheme}://{host}/robots.txt"
            try:
                response = self._client.get(robots_url)
                parser.parse(response.text.splitlines() if response.status_code == 200 else [])
            except httpx.HTTPError:
                parser.parse([])  # unreachable robots.txt -> allow
            self._robots[host] = parser
        return self._robots[host].can_fetch(settings.user_agent, url)

    def fetch(self, url: str) -> FetchedPage:
        if not self.allowed(url):
            return FetchedPage(
                url, None, None, "", "", crawl_allowed=False, error="disallowed by robots.txt"
            )
        try:
            response = self._client.get(url)
        except httpx.HTTPError as exc:
            return FetchedPage(url, None, None, "", "", error=f"fetch failed: {exc}")
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "text/plain" not in content_type:
            return FetchedPage(
                url,
                None,
                response.status_code,
                "",
                "",
                error=f"skipped non-HTML content-type {content_type}",
            )
        body = response.content[: settings.crawl_max_response_bytes]
        return _parse_html(
            url, response.status_code, body.decode(response.encoding or "utf-8", errors="replace")
        )

    def close(self) -> None:
        self._client.close()


class FixtureFetcher:
    """Serves saved HTML from fixtures/sites/<domain>/<page>.html (demo mode & tests)."""

    def __init__(self, fixtures_dir: Path) -> None:
        self.sites_dir = fixtures_dir / "sites"

    def allowed(self, url: str) -> bool:
        return True

    def fetch(self, url: str) -> FetchedPage:
        parsed = urlparse(url)
        domain = (parsed.hostname or "").removeprefix("www.")
        page = parsed.path.strip("/").replace("/", "_") or "index"
        page = re.sub(r"\.html?$", "", page)
        path = self.sites_dir / domain / f"{page}.html"
        if not path.exists():
            return FetchedPage(url, None, 404, "", "", error="fixture not found")
        return _parse_html(url, 200, path.read_text(encoding="utf-8"))

    def close(self) -> None:
        pass


def _parse_html(url: str, status: int, html: str) -> FetchedPage:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else None
    text = re.sub(r"\n{3,}", "\n\n", soup.get_text(separator="\n", strip=True))
    # Fragments never change the fetched document — strip them so /page and
    # /page#section are one URL.
    links = [urljoin(url, a["href"]).split("#")[0] for a in soup.find_all("a", href=True)]
    links = [link for link in links if link]
    return FetchedPage(
        url=url,
        title=title,
        http_status=status,
        text=text[:200_000],
        content_hash=hashlib.sha256(text.encode()).hexdigest()[:32],
        links=links,
    )


def make_fetcher() -> Fetcher | FixtureFetcher:
    from worker.config import FIXTURES_DIR

    if settings.demo_mode:
        return FixtureFetcher(FIXTURES_DIR)
    return Fetcher()


def _crawlable(url: str, domain: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").removeprefix("www.")
    if host != domain:
        return False
    return not (_SKIP_EXTENSIONS.search(parsed.path) or _SKIP_PATH_WORDS.search(url))


def _link_priority(url: str) -> int:
    path = urlparse(url).path.lower()
    for i, word in enumerate(_PRIORITY_WORDS):
        if word in path:
            return i
    return len(_PRIORITY_WORDS)


def crawl_site(
    website_url: str, fetcher: Fetcher | FixtureFetcher | None = None
) -> list[FetchedPage]:
    """Crawl up to crawl_max_pages pages of one site, prioritized, depth <= crawl_max_depth."""
    owns_fetcher = fetcher is None
    fetcher = fetcher or make_fetcher()
    parsed = urlparse(website_url)
    domain = (parsed.hostname or "").removeprefix("www.")
    base = f"{parsed.scheme}://{parsed.netloc}"

    # Seed queue: homepage plus conventional priority paths.
    queue: list[tuple[str, int]] = [
        (f"{base}/{p}".rstrip("/") + ("" if p else ""), 0) for p in PRIORITY_PATHS
    ]
    seen: set[str] = set()
    hashes: set[str] = set()
    pages: list[FetchedPage] = []

    try:
        while queue and len(pages) < settings.crawl_max_pages:
            url, depth = queue.pop(0)
            normalized = url.rstrip("/") or url
            if normalized in seen or depth > settings.crawl_max_depth:
                continue
            seen.add(normalized)
            if not _crawlable(url, domain):
                continue

            page = fetcher.fetch(url)
            if isinstance(fetcher, Fetcher):  # politeness delay for live sites only
                time.sleep(settings.crawl_delay_seconds)

            if page.error and page.http_status in (None, 404):
                log.debug("skip %s: %s", url, page.error)
                continue
            if page.content_hash and page.content_hash in hashes:
                continue
            if page.content_hash:
                hashes.add(page.content_hash)
            pages.append(page)

            child_links = sorted(
                {link for link in page.links if _crawlable(link, domain)},
                key=_link_priority,
            )
            for link in child_links[:15]:
                if link.rstrip("/") not in seen:
                    queue.append((link, depth + 1))
    finally:
        if owns_fetcher:
            fetcher.close()

    return pages
