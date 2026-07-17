"""Task-type -> handler registry."""

from collections.abc import Callable

import psycopg

from worker.handlers.discovery import handle_discover_candidates, handle_process_csv_import
from worker.handlers.qualify import (
    handle_generate_hypotheses,
    handle_generate_outreach_draft,
    handle_score_business,
)
from worker.handlers.research import handle_extract_facts, handle_research_website
from worker.queue import Task

HANDLERS: dict[str, Callable[[psycopg.Connection, Task], None]] = {
    "discover_candidates": handle_discover_candidates,
    "process_csv_import": handle_process_csv_import,
    "research_website": handle_research_website,
    "extract_facts": handle_extract_facts,
    "score_business": handle_score_business,
    "generate_hypotheses": handle_generate_hypotheses,
    "generate_outreach_draft": handle_generate_outreach_draft,
}
