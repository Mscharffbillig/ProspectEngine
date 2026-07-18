# ProspectEngine

Internal lead-discovery and customer-research tool for a solo software consultant.
It automates business discovery, website research, evidence-backed qualification,
and outreach drafting — so that reviewing ~5 worthwhile leads takes minutes, not
evenings.

**It never sends messages automatically.** Every claim it makes is stored with a
source URL, supporting excerpt, and confidence label.

## Repository structure

```text
apps/web                  Next.js 15 + TypeScript + Tailwind web app (Neon Auth, Drizzle ORM)
apps/web/src/db/schema.ts Drizzle schema — source of truth for the database
apps/web/drizzle/         Generated SQL migrations (committed; applied with drizzle-kit)
services/research-worker  Python 3.11+ background worker (discovery, crawl, extract, score, draft)
fixtures/                 Demo search results, demo business websites, sample CSV
docs/                     EC2 deployment guide
```

## Stack

- **Database**: Neon Postgres. The web app talks to it through **Drizzle ORM**
  (`@neondatabase/serverless` HTTP driver, pooled connection string); the Python
  worker connects with psycopg using the same pooled string (single-statement
  autocommit, safe through the transaction-mode pooler). Migrations use the
  **direct** connection string.
- **Auth**: **Neon Auth** (Stack). Single-user MVP; sign-in pages are served at
  `/handler/*`. If the STACK env vars are absent the app runs open with a
  warning banner so local demo work needs zero external accounts.
- **Worker queue**: plain Postgres (`FOR UPDATE SKIP LOCKED`) — unchanged.

## How it works

1. Create a campaign (industries, locations, filters, minimum score).
2. Click **Run discovery** — this queues a task in Postgres.
3. The Python worker claims tasks and runs the pipeline:
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

## Neon setup

1. Create a Neon project named **ProspectEngine** (console or
   `npx neonctl projects create --name ProspectEngine`).
2. From the project dashboard copy **both** connection strings into `.env`
   (see `.env.example`):
   - `DATABASE_URL` — pooled (host contains `-pooler`)
   - `DIRECT_DATABASE_URL` — direct
3. Enable **Neon Auth** on the project (Console → Auth) and copy
   `NEXT_PUBLIC_STACK_PROJECT_ID`, `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`,
   and `STACK_SECRET_SERVER_KEY` into `.env`.
4. Apply migrations and seed:

```bash
cd apps/web
npm install
npm run db:migrate     # applies apps/web/drizzle/*.sql via the direct URL
npm run db:seed        # scoring rules + example campaign (idempotent)
```

## Local development

```bash
cp .env.example .env          # then fill in the Neon values above

# Web app
cd apps/web
npm install
npm run dev                   # http://localhost:3000

# Worker (separate terminal)
cd services/research-worker
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate on Linux/macOS
pip install -e ".[dev]"
python -m worker.main poll    # or `once` to drain the queue and exit
```

The web app falls back to the repo-root `.env` automatically (see
`apps/web/next.config.ts` and `drizzle.config.ts`), so one env file serves the
web app, migrations, and worker.

Open http://localhost:3000, sign in through Neon Auth (or use the open
no-auth mode if you haven't configured it yet), open the seeded *Minnesota
Trade Businesses* campaign, and click **Run discovery**. With `DEMO_MODE=true`
(the default) the worker uses fixture search results and fixture websites — no
paid credentials needed. Within a few seconds the review queue fills with
scored, evidence-backed demo leads.

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
| `DATABASE_URL` | Neon **pooled** connection string (web app + worker) |
| `DIRECT_DATABASE_URL` | Neon **direct** connection string (migrations only) |
| `NEXT_PUBLIC_STACK_PROJECT_ID` / `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY` | Neon Auth (browser-safe) |
| `STACK_SECRET_SERVER_KEY` | Neon Auth server key — never sent to the browser |
| `BRAVE_SEARCH_API_KEY` | Live discovery (optional; demo mode works without) |
| `HUNTER_API_KEY` | Optional email enrichment (Phase 2 adapter) |
| `AI_PROVIDER` / `ANTHROPIC_API_KEY` / `AI_MODEL` | Optional AI analysis (Phase 2) |
| `CRAWLER_USER_AGENT` / `CRAWLER_CONTACT_EMAIL` | Crawler identity sent to websites |
| `DEMO_MODE` | `true` = fixture search + fixture websites |

## Migrations

`apps/web/src/db/schema.ts` is the source of truth. Workflow:

```bash
cd apps/web
# edit src/db/schema.ts, then:
npm run db:generate    # writes a new SQL file into apps/web/drizzle/
npm run db:migrate     # applies pending migrations (direct URL)
```

Generated SQL is committed, so GitHub remains the source of truth. The
`0001_updated_at_triggers.sql` migration is hand-written (drizzle-kit
`--custom`) because the Python worker writes rows without going through
Drizzle and still needs `updated_at` maintained.

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

## Deployment

See [docs/DEPLOYMENT_EC2.md](docs/DEPLOYMENT_EC2.md) for running the worker on
Ubuntu EC2 (systemd service or cron) against Neon, and options for hosting the
web app.

## Accounts you must create manually

- **Neon project** (free tier fine) — database + Neon Auth.
- **Brave Search API key** (free tier: 2,000 queries/mo) — for live discovery.
- **Hunter.io** (optional) — email enrichment, Phase 2.
- **Anthropic API key** (optional) — AI summaries/drafts, Phase 2.

## Assumptions made

- **Single org, single user.** Any signed-in Neon Auth user has full access
  (there is exactly one). Access control is enforced at the application
  boundary (auth middleware); the schema keeps UUID keys everywhere so tenant
  separation can be added later without a structural rewrite.
- **The worker connects straight to Postgres** and runs only in trusted
  environments.
- **No auth configured ⇒ app runs open** with a visible warning banner. This
  keeps the zero-credential demo path working; don't expose an unconfigured
  instance to the internet.
- **Draft generation is a worker task** (like scoring), so drafting logic lives in
  exactly one place; the UI shows drafts once the worker processes the queue.
- **Fixture domains use `.example.com` hosts** that are never fetched live; demo
  mode swaps in a filesystem fetcher.
- **Python 3.11+** (developed and tested on 3.14; no 3.11-only features used).
- **Campaign keyword/characteristic fields** are stored and shown to the operator
  now; only industries/locations/max-candidates/min-score drive automation in
  Phase 1 (keywords influence AI analysis in Phase 2).

## Known limitations

- Migrations have not yet been executed against a live Neon database from this
  machine (Neon CLI auth pending); run `npm run db:migrate && npm run db:seed`
  once your Neon project exists.
- OSM Overpass adapter, Hunter enrichment, and AI provider integration are
  Phase 2 (interfaces exist; adapters not yet implemented).
- Scheduled/recurring campaign runs are manual-trigger only.
- Search-result company names are parsed from result titles; odd titles can
  produce awkward names.
- Scoring-rule editing happens via SQL (Neon Console), not the settings UI.
- The crawler does not render JavaScript (by design); JS-only sites record a
  research failure rather than being browsed with automation.

## Recommended next steps (Phase 2)

1. Scheduled campaign runs (worker cron loop reading `campaigns.next_run_at`).
2. OSM Overpass adapter behind the existing `SearchAdapter`-style interface.
3. AI provider abstraction: summaries, classification, pain hypotheses, drafts
   (grounded in stored facts, JSON-schema validated).
4. Hunter enrichment adapter (only when key configured; never auto-send to
   pattern-guessed emails).
5. CSV export of leads.
6. Follow-up queue polish + rejection-pattern reporting (Phase 3).
