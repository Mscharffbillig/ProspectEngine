"""Database-backed task queue.

Claiming uses UPDATE ... (SELECT ... FOR UPDATE SKIP LOCKED) so two workers can
never process the same task. Stale locks (crashed worker) become claimable once
lock_expires_at passes. Pure decision logic lives in small functions so it can
be unit tested without a database.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psycopg

from worker.config import settings
from worker.db import jsonb

log = logging.getLogger(__name__)

LOCK_MINUTES = 10


@dataclass
class Task:
    id: str
    task_type: str
    campaign_id: str | None
    business_id: str | None
    payload: dict[str, Any]
    attempts: int
    max_attempts: int


# ── pure decision logic (unit tested) ────────────────────────────────


def is_claimable(
    status: str,
    scheduled_at: datetime,
    lock_expires_at: datetime | None,
    now: datetime | None = None,
) -> bool:
    """A task is claimable if pending and due, or running with an expired lock."""
    now = now or datetime.now(UTC)
    if status == "pending":
        return scheduled_at <= now
    if status == "running":
        return lock_expires_at is not None and lock_expires_at < now
    return False


def next_state_after_failure(attempts: int, max_attempts: int) -> str:
    """After a failed attempt: retry (pending) until attempts exhaust, then failed."""
    return "failed" if attempts >= max_attempts else "pending"


def retry_delay_seconds(attempts: int) -> int:
    """Exponential backoff: 30s, 60s, 120s..."""
    return 30 * (2 ** max(0, attempts - 1))


# ── database operations ──────────────────────────────────────────────

CLAIM_SQL = """
update research_tasks set
  status = 'running',
  locked_by = %(worker_id)s,
  lock_expires_at = now() + make_interval(mins => %(lock_minutes)s),
  started_at = now(),
  attempts = attempts + 1
where id = (
  select id from research_tasks
  where (status = 'pending' and scheduled_at <= now())
     or (status = 'running' and lock_expires_at < now())
  order by priority desc, scheduled_at asc
  limit 1
  for update skip locked
)
returning id, task_type, campaign_id, business_id, payload, attempts, max_attempts
"""


def claim_task(conn: psycopg.Connection) -> Task | None:
    row = conn.execute(
        CLAIM_SQL, {"worker_id": settings.worker_id, "lock_minutes": LOCK_MINUTES}
    ).fetchone()
    if row is None:
        return None
    return Task(
        id=str(row["id"]),
        task_type=row["task_type"],
        campaign_id=str(row["campaign_id"]) if row["campaign_id"] else None,
        business_id=str(row["business_id"]) if row["business_id"] else None,
        payload=row["payload"] or {},
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
    )


def complete_task(conn: psycopg.Connection, task: Task) -> None:
    conn.execute(
        """update research_tasks
           set status = 'done', completed_at = now(), locked_by = null,
               lock_expires_at = null, last_error = null
           where id = %s""",
        (task.id,),
    )


def fail_task(conn: psycopg.Connection, task: Task, error: str) -> None:
    state = next_state_after_failure(task.attempts, task.max_attempts)
    delay = retry_delay_seconds(task.attempts)
    log.warning(
        "task %s (%s) failed attempt %d/%d -> %s: %s",
        task.id,
        task.task_type,
        task.attempts,
        task.max_attempts,
        state,
        error,
    )
    conn.execute(
        """update research_tasks
           set status = %s, last_error = %s, locked_by = null, lock_expires_at = null,
               completed_at = case when %s = 'failed' then now() else null end,
               scheduled_at = case when %s = 'pending'
                                   then now() + make_interval(secs => %s)
                                   else scheduled_at end
           where id = %s""",
        (state, error[:2000], state, state, delay, task.id),
    )


def enqueue(
    conn: psycopg.Connection,
    task_type: str,
    campaign_id: str | None = None,
    business_id: str | None = None,
    payload: dict[str, Any] | None = None,
    priority: int = 0,
) -> str:
    row = conn.execute(
        """insert into research_tasks (task_type, campaign_id, business_id, payload, priority)
           values (%s, %s, %s, %s, %s) returning id""",
        (task_type, campaign_id, business_id, jsonb(payload or {}), priority),
    ).fetchone()
    assert row is not None
    return str(row["id"])
