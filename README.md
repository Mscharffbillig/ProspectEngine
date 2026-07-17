# Lead Generator

Internal lead-discovery and customer-research tool for a solo software consultant.
It automates business discovery, website research, evidence-backed qualification,
and outreach drafting — so that reviewing ~5 worthwhile leads takes minutes, not
evenings.

**It never sends messages automatically.** Every claim it makes is stored with a
source URL, supporting excerpt, and confidence label.

## Repository structure

```text
apps/web                  Next.js 15 + TypeScript + Tailwind web app (Supabase auth)
services/research-worker  Python 3.11+ background worker (discovery, crawl, extract, score, draft)
supabase/migrations       SQL schema (run with the Supabase CLI)
supabase/seed.sql         Scoring rules + example "Minnesota Trade Businesses" campaign
fixtures/                 Demo search results, demo business websites, sample CSV
docs/                     EC2 deployment guide
```

## How it works

1. Create a campaign (industries, locations, filters, minimum score).
2. Click **Run discovery** — this queues a task in Postgres.
3. The Python worker claims tasks (`FOR UPDATE SKIP LOCKED`), runs the pipeline:
   `discover_candidates → research_website → extract_facts → score_business → generate_hypotheses`.
4. Discovery uses the Brave Search API (or local fixtures in demo mode), filters
   directory/aggregator sites, normalizes candidates, and merges duplicates by
   weighted signals (domain, phone, name+city, address) — original source
   records are always retained.
5. The crawler respects robots.txt, crawls at most 7 pages / depth 2 per site,
   stays on-domain, and applies per-domain delays.
6. Extraction produces facts (each with value/confidence/source URL/excerpt/method);
   a transparent rules engine (editable `qualification_rules` table) computes the
   score and stores per-rule evidence.
7. You review ranked leads (`/review`), approve/reject/snooze; approving queues a
   template outreach draft grounded only in saved evidence.
8. Marking a draft sent (after you copy it into your own email client) schedules
   follow-up reminders at 4 and 10 days; replies stop reminders; opt-outs go on a
   permanent suppression list that discovery also checks.

## Local setup

Prerequisites: Node 20+, Python 3.11+, Docker (for local Supabase),
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# 1. Environment
cp .env.example .env          # defaults work for local demo mode

# 2. Database (local Supabase; runs migrations + seed automatically)
supabase start                # from the repo root
supabase db reset             # applies supabase/migrations + supabase/seed.sql

# 3. Web app
cd apps/web
npm install
npm run dev                   # http://localhost:3000

# 4. Worker (separate terminal)
cd services/research-worker
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate on Linux/macOS
pip install -e ".[dev]"
python -m worker.main poll    # or `once` to drain the queue and exit
```

After `supabase start`, copy the printed `anon key` / `service_role key` into
`.env` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and set
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
The web app falls back to the repo-root `.env` automatically (see
`apps/web/next.config.ts`), so one env file serves both the web app and worker.

Then open http://localhost:3000, **sign up** (first account becomes the primary
user), open the seeded *Minnesota Trade Businesses* campaign, and click
**Run discovery**. With `DEMO_MODE=true` (the default) the worker uses fixture
search results and fixture websites — no paid credentials needed. Within a few
seconds the review queue fills with scored, evidence-backed demo leads.

## Demo walkthrough (no paid APIs)

1. Run discovery on the seeded campaign → 5 fixture businesses are found
   (a strong-fit excavator, an HVAC company, a solo plumber, a national
   franchise, a landscaper). Aggregator results (Yelp, Angi…) are filtered.
2. `/review` shows them ranked; the franchise and solo operator score low with
   negative evidence chips; the excavator scores high (crews, commercial work,
   named owner + operations manager, equipment, hiring).
3. Approve the excavator → an outreach draft grounded in its saved facts appears
   in `/outreach`. Copy it, mark it sent → follow-ups get scheduled.
4. `/import` accepts `fixtures/sample-import.csv` (preview + validation); the
   worker deduplicates the Northstar row into the existing business instead of
   creating a duplicate.

## Environment variables

See `.env.example`. Highlights:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web app → Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only; never sent to the browser |
| `DATABASE_URL` | Worker → Postgres direct connection |
| `BRAVE_SEARCH_API_KEY` | Live discovery (optional; demo mode works without) |
| `HUNTER_API_KEY` | Optional email enrichment (Phase 2 adapter) |
| `AI_PROVIDER` / `ANTHROPIC_API_KEY` / `AI_MODEL` | Optional AI analysis (Phase 2) |
| `CRAWLER_USER_AGENT` / `CRAWLER_CONTACT_EMAIL` | Crawler identity sent to websites |
| `DEMO_MODE` | `true` = fixture search + fixture websites |

## Testing & linting

```bash
# Worker (58 tests: normalization incl. LLC/Inc/Corp suffixes, dedup weights,
# scoring + evidence, extraction from HTML fixtures, task-lock logic)
cd services/research-worker
.venv/Scripts/python -m pytest
.venv/Scripts/python -m ruff check .
.venv/Scripts/python -m ruff format --check .

# Web
cd apps/web
npm run lint
npm run build        # includes strict type-checking
```

## Migrations

Migrations live in `supabase/migrations` and are applied with
`supabase db reset` (local) or `supabase db push` (hosted project). The schema
covers campaigns, businesses, sources, contacts, website pages, extracted facts,
qualification rules/runs/evidence, pain hypotheses, outreach drafts/events,
follow-ups, suppression list, research tasks/runs, and import jobs. RLS is
enabled on every table (single-org policy: any authenticated user).

## Deployment

See [docs/DEPLOYMENT_EC2.md](docs/DEPLOYMENT_EC2.md) for running the worker on
Ubuntu EC2 (systemd service or cron) against a hosted Supabase project, and
options for hosting the web app.

## Accounts you must create manually

- **Supabase project** (free tier fine) — for hosted use; local Docker works for demo.
- **Brave Search API key** (free tier: 2,000 queries/mo) — for live discovery.
- **Hunter.io** (optional) — email enrichment, Phase 2.
- **Anthropic API key** (optional) — AI summaries/drafts, Phase 2.

## Assumptions made

- **Single org, single user.** RLS grants full access to any authenticated user;
  the schema keeps UUID keys everywhere so tenant separation can be added later
  (add `org_id` + new policies, no structural rewrite).
- **The worker connects straight to Postgres** (`DATABASE_URL`) and bypasses RLS;
  it runs only in trusted environments.
- **Draft generation is a worker task** (like scoring), so drafting logic lives in
  exactly one place; the UI shows drafts once the worker processes the queue.
- **Fixture domains use `.example.com` hosts** that are never fetched live; demo
  mode swaps in a filesystem fetcher.
- **Python 3.11+** (developed and tested on 3.14; no 3.11-only features used).
- **Local Supabase (free, Docker) counts as "no paid credentials"** for demo mode.
- **Campaign keyword/characteristic fields** are stored and shown to the operator
  now; only industries/locations/max-candidates/min-score drive automation in
  Phase 1 (keywords influence AI analysis in Phase 2).

## Known limitations

- OSM Overpass adapter, Hunter enrichment, and AI provider integration are
  Phase 2 (interfaces exist; adapters not yet implemented).
- Scheduled/recurring campaign runs are manual-trigger only (cron the worker +
  a small SQL insert, or wait for Phase 2 scheduler).
- Search-result company names are parsed from result titles; odd titles can
  produce awkward names (editable on the business page via notes; full inline
  editing is Phase 3).
- Scoring-rule editing happens in Supabase Studio, not the settings UI.
- The crawler does not render JavaScript (by design); JS-only sites record a
  research failure rather than being browsed with automation.
- No task-queue integration test against a live Postgres yet (lock logic is
  unit-tested; the SQL uses standard `FOR UPDATE SKIP LOCKED`).

## Recommended next steps (Phase 2)

1. Scheduled campaign runs (worker cron loop reading `campaigns.next_run_at`).
2. OSM Overpass adapter behind the existing `SearchAdapter`-style interface.
3. AI provider abstraction: summaries, classification, pain hypotheses, drafts
   (grounded in stored facts, JSON-schema validated).
4. Hunter enrichment adapter (only when key configured; never auto-send to
   pattern-guessed emails).
5. CSV export of leads.
6. Follow-up queue polish + rejection-pattern reporting (Phase 3).
