"""Worker entry point.

python -m worker.main once      # process queued tasks until the queue is empty
python -m worker.main poll      # run continuously (systemd / EC2)
python -m worker.main status    # print queue depth
"""

import argparse
import logging
import sys
import time

from worker import db, queue
from worker.config import settings
from worker.handlers import HANDLERS

log = logging.getLogger("worker")


def process_one(conn) -> bool:
    """Claim and run a single task. Returns False when the queue is empty."""
    task = queue.claim_task(conn)
    if task is None:
        return False
    handler = HANDLERS.get(task.task_type)
    if handler is None:
        queue.fail_task(conn, task, f"no handler for task type {task.task_type}")
        return True
    log.info("task %s: %s (attempt %d)", task.id, task.task_type, task.attempts)
    try:
        handler(conn, task)
        queue.complete_task(conn, task)
    except Exception as exc:
        log.exception("task %s failed", task.id)
        queue.fail_task(conn, task, f"{type(exc).__name__}: {exc}")
    return True


def run_once() -> None:
    with db.connect() as conn:
        db.heartbeat(conn, {"mode": "once", "demo_mode": settings.demo_mode})
        processed = 0
        while process_one(conn):
            processed += 1
        db.heartbeat(
            conn, {"mode": "once", "demo_mode": settings.demo_mode, "last_batch": processed}
        )
        log.info("processed %d task(s); queue empty", processed)


def run_poll() -> None:
    log.info(
        "polling every %ds as %s (demo_mode=%s)",
        settings.worker_poll_seconds,
        settings.worker_id,
        settings.demo_mode,
    )
    while True:
        try:
            with db.connect() as conn:
                while True:
                    db.heartbeat(conn, {"mode": "poll", "demo_mode": settings.demo_mode})
                    if not process_one(conn):
                        time.sleep(settings.worker_poll_seconds)
        except KeyboardInterrupt:
            log.info("stopping")
            return
        except Exception:
            log.exception("worker loop error; reconnecting in 10s")
            time.sleep(10)


def run_reprocess() -> None:
    """Safely re-run the pipeline over existing businesses.

    Recrawls every business that has a website (skipping do-not-contact),
    which refreshes pages + DOM metadata, replaces automated facts and
    contacts, re-resolves the canonical name (never downgrading manual or
    higher-confidence names), re-validates, re-scores under the current
    scoring version, and regenerates hypotheses for valid leads only.
    Manual edits, decisions, notes, and outreach history are preserved;
    no duplicate business records are created.
    """
    with db.connect() as conn:
        rows = conn.execute(
            """select id, campaign_id from businesses
               where website_url is not null and status != 'do_not_contact'"""
        ).fetchall()
        for row in rows:
            queue.enqueue(
                conn,
                "research_website",
                campaign_id=str(row["campaign_id"]) if row["campaign_id"] else None,
                business_id=str(row["id"]),
            )
        log.info("queued reprocessing for %d businesses; draining queue", len(rows))
        db.heartbeat(conn, {"mode": "reprocess", "demo_mode": settings.demo_mode})
        processed = 0
        while process_one(conn):
            processed += 1
        log.info("reprocessing complete: %d task(s) processed", processed)


def print_status() -> None:
    with db.connect() as conn:
        rows = conn.execute(
            "select status, count(*) as n from research_tasks group by status"
        ).fetchall()
        for row in rows:
            print(f"{row['status']:>10}: {row['n']}")
        if not rows:
            print("queue is empty")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )
    parser = argparse.ArgumentParser(description="Lead research worker")
    parser.add_argument(
        "mode", choices=["once", "poll", "status", "reprocess"], nargs="?", default="once"
    )
    args = parser.parse_args()
    {
        "once": run_once,
        "poll": run_poll,
        "status": print_status,
        "reprocess": run_reprocess,
    }[args.mode]()


if __name__ == "__main__":
    main()
