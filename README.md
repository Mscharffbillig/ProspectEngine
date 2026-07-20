# ProspectEngine

Internal lead-discovery and customer-research tool for a solo software consultant.
It automates business discovery, website research, evidence-backed qualification,
and outreach drafting — so that reviewing ~5 worthwhile leads takes minutes, not
evenings.

**It never sends messages automatically.** Every claim it makes is stored with a
source URL, supporting excerpt, and confidence label.

## Repository structure

```text
apps/web                  Next.js 16 + TypeScript + Tailwind web app (Neon Auth, Drizzle ORM)
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
- **Auth**: **Neon Auth** (managed Better Auth, `@neondatabase/auth`). The auth
  server is hosted by Neon; the app mounts a proxy at `/api/auth/*`, protects
  routes in `src/proxy.ts`, and serves its own sign-in page at `/auth/sign-in`.
  Users live in the `neon_auth` schema of the project database. If
  `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` are absent the app runs open
  with a warning banner so local demo work needs zero external accounts.
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
6. Extraction produces facts (each with value/confidence/source URL/excerpt/method).
   The canonical business name is resolved from ranked website evidence
   (JSON-LD → og:site_name → header brand/logo → footer legal name → cleaned
   title → search title as low-confidence fallback); people are extracted only
   from JSON-LD, DOM team sections, or strict single-line text patterns, with
   navigation labels and generic words rejected. Decision-makers require
   high/confirmed confidence.
7. Hard validation gates run before scoring (meaningful crawl, operating
   business, industry match, geography match, identity coherence — the
   canonical name must agree with the domain/email identity or have
   multi-source support — and not a franchise); a business that fails a gate
   can never be marked qualified regardless of score. A transparent rules
   engine (editable `qualification_rules` table, scoring v3.0) then computes
   the score — each rule requires a minimum evidence confidence, and
   contactability is de-weighted so it cannot compensate for weak fit.
   Finally, qualification requires at least one high-confidence
   **operational-complexity** signal (crews, coordinated hiring, multiple
   territories, company-owned equipment, recurring/emergency operations, or a
   named operations role); existence + contactability alone leaves a lead in
   needs_review with an `insufficient_complexity_evidence` warning.
   Leads failing validation show **Override validation** instead of Approve —
   overriding requires a reason and is recorded in an audit table
   (`validation_overrides`) with user, timestamp, and the failed gates.
8. You review ranked leads (`/review`), approve/reject/snooze; approving queues a
   template outreach draft grounded only in saved evidence. Every scoring badge
   expands to show its confidence, excerpt, and source page; a validation panel
   shows gate outcomes; unverified person candidates are labeled and never used
   for greetings. On a lead's detail page a **Corrections** panel lets you fix
   what you found by visiting the site yourself — business fields and contacts
   (including confirming a decision-maker for outreach). Corrections are marked
   as operator-confirmed so re-research never overwrites them, and saving
   re-runs validation + scoring in the worker. **Export all (CSV)** on the
   review page downloads every lead with its key research fields.
9. Marking a draft sent (after you copy it into your own email client) schedules
   follow-up reminders at 4 and 10 days; replies stop reminders; opt-outs go on a
   permanent suppression list that discovery also checks.

## Neon setup

1. Create a Neon project named **ProspectEngine** (console or
   `npx neonctl projects create --name ProspectEngine`).
2. From the project dashboard copy **both** connection strings into `.env`
   (see `.env.example`):
   - `DATABASE_URL` — pooled (host contains `-pooler`)
   - `DIRECT_DATABASE_URL` — direct
3. Enable **Neon Auth** on the project (Console → Auth), copy the Auth base URL
   into `NEON_AUTH_BASE_URL`, and set `NEON_AUTH_COOKIE_SECRET` to any random
   32+ character string (`openssl rand -base64 32`).
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

**The worker must be running for “Run discovery” to do anything** — clicking
Run discovery only queues a task; the worker executes it. To run it
automatically instead of keeping a terminal open (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File services/research-worker/install-worker-task.ps1
```

This installs a hidden launcher in your Startup folder (`run-worker.ps1`, guarded
so it never double-starts) that polls forever at every logon. Remove it with
`install-worker-task.ps1 -Uninstall`. On Linux/EC2, run `poll` under systemd
(see the deployment guide).

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
| `NEON_AUTH_BASE_URL` | Neon Auth server URL (Console → Auth) |
| `NEON_AUTH_COOKIE_SECRET` | 32+ char secret for session cookies — server-side only |
| `BRAVE_SEARCH_API_KEY` | Live discovery (optional; demo mode works without) |
| `HUNTER_API_KEY` | Optional email enrichment (Phase 2 adapter) |
| `AI_PROVIDER` / `ANTHROPIC_API_KEY` / `AI_MODEL` | Optional AI analysis (Phase 2) |
| `CRAWLER_USER_AGENT` / `CRAWLER_CONTACT_EMAIL` | Crawler identity sent to websites |
| `DEMO_MODE` | `true` = fixture search + fixture websites |

## Reprocessing existing leads

After extraction/scoring changes (or to refresh stale research), rerun the
pipeline safely over everything already in the database:

```bash
cd services/research-worker
.venv/Scripts/python -m worker.main reprocess
```

This recrawls each business website (refreshing pages and DOM metadata),
replaces automated facts and contacts, re-resolves canonical names (a manual
or higher-confidence name is never downgraded), re-runs validation and scoring
under the current scoring version, and regenerates hypotheses for valid leads
only. Manual edits, decisions, notes, and outreach history are preserved, and
no duplicate business records are created. Do-not-contact businesses are
skipped.

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
5. Follow-up queue polish + rejection-pattern reporting (Phase 3).
