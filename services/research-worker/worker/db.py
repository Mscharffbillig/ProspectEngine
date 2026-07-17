"""Postgres access for the worker (direct connection, bypasses RLS)."""

import json
import logging
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from worker.config import settings

log = logging.getLogger(__name__)


def connect() -> psycopg.Connection:
    return psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True)


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value, dumps=lambda v: json.dumps(v, default=str))


def heartbeat(conn: psycopg.Connection, info: dict[str, Any]) -> None:
    conn.execute(
        """
        insert into worker_heartbeats (id, last_seen_at, info)
        values (%s, now(), %s)
        on conflict (id) do update set last_seen_at = now(), info = excluded.info
        """,
        (settings.worker_id, jsonb(info)),
    )
