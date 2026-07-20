"""Optional external providers for enrichment: Hunter (contacts) and an AI
opportunity analysis. Both are optional and replaceable; when a key is missing,
the provider is unavailable, rate-limited, or errors, the caller records the
outcome and continues. Retries are bounded (<=2 for transient network errors,
never for auth/quota).
"""

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx

from worker.config import settings

log = logging.getLogger(__name__)

MAX_TRANSIENT_RETRIES = 2


class ProviderAuthError(RuntimeError):
    """Authentication/authorization failure — do not retry."""


class ProviderQuotaError(RuntimeError):
    """Quota/rate-limit exhaustion — do not retry within a run."""


@dataclass
class ProviderResult:
    provider: str
    operation: str
    configured: bool = True
    success: bool = False
    request_count: int = 0
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    data: dict = field(default_factory=dict)


def _get_json(client: httpx.Client, url: str, params: dict) -> dict:
    """GET with bounded retry. Raises ProviderAuth/QuotaError for 401/403/429."""
    last_exc: Exception | None = None
    for attempt in range(MAX_TRANSIENT_RETRIES + 1):
        try:
            resp = client.get(url, params=params)
        except httpx.HTTPError as exc:  # transient network failure
            last_exc = exc
            time.sleep(min(2**attempt, 4))
            continue
        if resp.status_code in (401, 403):
            raise ProviderAuthError(f"auth failed ({resp.status_code})")
        if resp.status_code == 429:
            raise ProviderQuotaError("rate limited (429)")
        if resp.status_code >= 500:
            last_exc = RuntimeError(f"server error {resp.status_code}")
            time.sleep(min(2**attempt, 4))
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"transient failure after retries: {last_exc}")


def hunter_domain_search(domain: str, *, client: httpx.Client | None = None) -> ProviderResult:
    """One Hunter domain-search request for a confirmed website domain."""
    result = ProviderResult(provider="hunter", operation="domain_search")
    if not settings.hunter_api_key:
        result.configured = False
        result.error = "HUNTER_API_KEY not configured"
        return result
    if not domain:
        result.error = "no domain to enrich"
        return result

    result.started_at = datetime.now(UTC)
    owns = client is None
    client = client or httpx.Client(timeout=20)
    try:
        payload = _get_json(
            client,
            "https://api.hunter.io/v2/domain-search",
            {"domain": domain, "api_key": settings.hunter_api_key, "limit": 10},
        )
        result.request_count = 1
        result.data = payload.get("data") or {}
        result.success = True
    except (ProviderAuthError, ProviderQuotaError) as exc:
        result.request_count = 1
        result.error = str(exc)
    except Exception as exc:  # noqa: BLE001 - graceful degradation
        result.error = f"{type(exc).__name__}: {exc}"
    finally:
        result.completed_at = datetime.now(UTC)
        if owns:
            client.close()
    return result


AI_SYSTEM_PROMPT = (
    "You analyze a small-business lead for a custom-software consultant. "
    "Use ONLY the supplied evidence. Never invent owners, employees, company "
    "size, revenue, software, workflows, or pain points. Every factual claim in "
    "a list item MUST include an evidence_ids array referencing the provided "
    "evidence IDs; omit anything you cannot support. Workflow problems are "
    "hypotheses. If evidence is weak, return mostly empty lists. You may advise "
    "against contacting the lead. Respond with a single JSON object only, with "
    "keys: business_summary, strongest_operational_signals, "
    "possible_workflow_problems, possible_custom_software_angles, "
    "existing_software_or_competitor_risk, disqualifiers, recommended_contact_path, "
    "discovery_questions, unresolved_questions, overall_confidence. Each list of "
    "claims is an array of objects {statement|hypothesis, evidence_ids}."
)


def ai_opportunity_brief(
    prompt_payload: dict, *, client: httpx.Client | None = None
) -> ProviderResult:
    """One AI request producing a structured, evidence-grounded opportunity brief.

    Only the Anthropic provider is wired here; any other AI_PROVIDER value (or a
    missing key) yields an unconfigured result and the stage is skipped.
    """
    result = ProviderResult(provider=settings.ai_provider or "ai", operation="opportunity_brief")
    if settings.ai_provider.lower() != "anthropic" or not settings.anthropic_api_key:
        result.configured = False
        result.error = "AI provider not configured (need AI_PROVIDER=anthropic + ANTHROPIC_API_KEY)"
        return result

    model = settings.ai_model or "claude-opus-4-8"
    result.model = model
    result.started_at = datetime.now(UTC)
    owns = client is None
    client = client or httpx.Client(timeout=60)
    try:
        for attempt in range(MAX_TRANSIENT_RETRIES + 1):
            try:
                resp = client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": settings.anthropic_api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": 1500,
                        "system": AI_SYSTEM_PROMPT,
                        "messages": [
                            {"role": "user", "content": json.dumps(prompt_payload, default=str)}
                        ],
                    },
                )
            except httpx.HTTPError as exc:
                if attempt >= MAX_TRANSIENT_RETRIES:
                    raise
                log.warning("AI transient error (attempt %d): %s", attempt + 1, exc)
                time.sleep(min(2**attempt, 4))
                continue
            if resp.status_code in (401, 403):
                raise ProviderAuthError(f"auth failed ({resp.status_code})")
            if resp.status_code == 429:
                raise ProviderQuotaError("rate limited (429)")
            if resp.status_code >= 500 and attempt < MAX_TRANSIENT_RETRIES:
                time.sleep(min(2**attempt, 4))
                continue
            resp.raise_for_status()
            body = resp.json()
            break
        result.request_count = 1
        usage = body.get("usage") or {}
        result.input_tokens = usage.get("input_tokens")
        result.output_tokens = usage.get("output_tokens")
        text = "".join(
            part.get("text", "")
            for part in (body.get("content") or [])
            if part.get("type") == "text"
        )
        result.data = {"raw_json": _extract_json(text)}
        result.success = True
    except (ProviderAuthError, ProviderQuotaError) as exc:
        result.request_count = 1
        result.error = str(exc)
    except Exception as exc:  # noqa: BLE001 - graceful degradation
        result.error = f"{type(exc).__name__}: {exc}"
    finally:
        result.completed_at = datetime.now(UTC)
        if owns:
            client.close()
    return result


def _extract_json(text: str) -> dict:
    """Best-effort parse of a JSON object from a model text response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{") :] if "{" in text else text
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        start, end = text.find("{"), text.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(text[start : end + 1])
            except (json.JSONDecodeError, ValueError):
                return {}
        return {}
