-- Lead Generator initial schema.
-- Single-org / single-user MVP. Every table carries created_at/updated_at and
-- RLS granting full access to authenticated users; the research worker
-- connects via DATABASE_URL (postgres role) and bypasses RLS.

create extension if not exists "pgcrypto";

-- ── helpers ──────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── users ────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── campaigns ────────────────────────────────────────────────────────

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  min_company_size integer,
  max_company_size integer,
  include_keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  preferred_characteristics text[] not null default '{}',
  excluded_characteristics text[] not null default '{}',
  workflow_problems text[] not null default '{}',
  geography text,
  max_candidates_per_run integer not null default 50,
  min_qualification_score integer not null default 30,
  ai_enabled boolean not null default false,
  status text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'archived')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaign_industries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  industry text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, industry)
);

create table campaign_locations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  location text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, location)
);

-- ── businesses ───────────────────────────────────────────────────────

create table businesses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete set null,
  name text not null,
  normalized_name text not null,
  website_url text,
  domain text,
  phone text,
  normalized_phone text,
  email text,
  address text,
  city text,
  state text,
  postal_code text,
  industry text,
  summary text,
  employee_estimate text,
  status text not null default 'unresearched'
    check (status in (
      'unresearched', 'researching', 'research_failed', 'qualified',
      'needs_review', 'approved', 'rejected', 'snoozed', 'ready_to_contact',
      'contacted', 'replied', 'interview_scheduled', 'problem_identified',
      'proposal_sent', 'pilot', 'won', 'lost', 'do_not_contact')),
  score integer,
  last_action_at timestamptz,
  next_action_at timestamptz,
  snoozed_until timestamptz,
  rejection_reason text
    check (rejection_reason is null or rejection_reason in (
      'too_small', 'too_large', 'wrong_industry', 'franchise_or_national',
      'weak_evidence', 'no_decision_maker', 'existing_software_sufficient',
      'duplicate', 'poor_fit', 'other')),
  loss_reason text,
  notes text,
  researched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index businesses_domain_key on businesses (domain) where domain is not null;
create index businesses_status_idx on businesses (status);
create index businesses_campaign_idx on businesses (campaign_id);
create index businesses_score_idx on businesses (score desc nulls last);
create index businesses_normalized_name_idx on businesses (normalized_name);
create index businesses_normalized_phone_idx on businesses (normalized_phone)
  where normalized_phone is not null;

-- Original discovery records. Never deleted on merge; duplicates re-point here.
create table business_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_type text not null
    check (source_type in ('search_api', 'osm', 'csv_import', 'manual')),
  source_ref text,
  query text,
  title text,
  url text,
  snippet text,
  rank integer,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index business_sources_business_idx on business_sources (business_id);
create unique index business_sources_osm_key on business_sources (source_ref)
  where source_type = 'osm' and source_ref is not null;

create table business_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text,
  role text,
  role_type text not null default 'unknown'
    check (role_type in ('owner', 'founder', 'general_manager',
      'operations_manager', 'office_manager', 'service_manager',
      'project_manager', 'other', 'unknown')),
  email text,
  email_source text
    check (email_source is null or email_source in (
      'website_published', 'enrichment_verified', 'pattern_unverified',
      'generic_business', 'contact_form_only')),
  email_confidence text
    check (email_confidence is null or email_confidence in (
      'confirmed', 'high', 'medium', 'low', 'unknown')),
  phone text,
  source_url text,
  excerpt text,
  is_decision_maker boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_contacts_business_idx on business_contacts (business_id);

-- ── research artifacts ───────────────────────────────────────────────

create table website_pages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  url text not null,
  title text,
  http_status integer,
  fetched_at timestamptz not null default now(),
  content_text text,
  content_hash text,
  source_type text not null default 'crawl',
  crawl_allowed boolean not null default true,
  extraction_meta jsonb,
  created_at timestamptz not null default now(),
  unique (business_id, url)
);

create index website_pages_business_idx on website_pages (business_id);

create table extracted_facts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  fact_key text not null,
  value text not null,
  confidence text not null default 'unknown'
    check (confidence in ('confirmed', 'high', 'medium', 'low', 'unknown')),
  source_url text,
  excerpt text,
  method text not null default 'heuristic'
    check (method in ('regex', 'heuristic', 'ai', 'import', 'manual')),
  page_id uuid references website_pages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index extracted_facts_business_idx on extracted_facts (business_id);
create index extracted_facts_key_idx on extracted_facts (fact_key);

-- ── qualification ────────────────────────────────────────────────────

-- Editable rules: signal key + points, no schema change needed to tune.
create table qualification_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  label text not null,
  points integer not null,
  active boolean not null default true,
  definition jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table qualification_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  total_score integer not null,
  scoring_version text not null,
  created_at timestamptz not null default now()
);

create index qualification_runs_business_idx on qualification_runs (business_id);

create table qualification_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references qualification_runs(id) on delete cascade,
  rule_key text not null,
  label text not null,
  points integer not null,
  evidence text,
  source_url text,
  created_at timestamptz not null default now()
);

create index qualification_evidence_run_idx on qualification_evidence (run_id);

create table pain_hypotheses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  question text not null,
  signal_key text not null,
  evidence text,
  source_url text,
  created_at timestamptz not null default now()
);

create index pain_hypotheses_business_idx on pain_hypotheses (business_id);

-- ── outreach ─────────────────────────────────────────────────────────

create table outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  contact_id uuid references business_contacts(id) on delete set null,
  subject text,
  body text not null,
  method text not null default 'template' check (method in ('template', 'ai')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'discarded')),
  sent_at timestamptz,
  channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outreach_drafts_business_idx on outreach_drafts (business_id);
create index outreach_drafts_status_idx on outreach_drafts (status);

create table outreach_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  draft_id uuid references outreach_drafts(id) on delete set null,
  event_type text not null
    check (event_type in ('sent', 'reply', 'bounce', 'opt_out', 'note')),
  channel text,
  occurred_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index outreach_events_business_idx on outreach_events (business_id);

create table follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  draft_id uuid references outreach_drafts(id) on delete set null,
  kind text not null default 'first_follow_up'
    check (kind in ('first_follow_up', 'final_follow_up', 'custom')),
  due_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index follow_up_tasks_due_idx on follow_up_tasks (status, due_date);

create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  domain text,
  email text,
  phone text,
  company_name text,
  reason text not null,
  created_at timestamptz not null default now(),
  check (domain is not null or email is not null
         or phone is not null or company_name is not null)
);

create unique index suppression_domain_key on suppression_list (lower(domain))
  where domain is not null;
create unique index suppression_email_key on suppression_list (lower(email))
  where email is not null;

-- ── background jobs ──────────────────────────────────────────────────

create table research_tasks (
  id uuid primary key default gen_random_uuid(),
  task_type text not null
    check (task_type in ('discover_candidates', 'research_website',
      'extract_facts', 'score_business', 'generate_hypotheses',
      'generate_outreach_draft', 'process_csv_import')),
  campaign_id uuid references campaigns(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  priority integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  locked_by text,
  lock_expires_at timestamptz,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_tasks_claim_idx on research_tasks (status, scheduled_at, priority);
create index research_tasks_business_idx on research_tasks (business_id);

create table research_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  stats jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now()
);

create index research_runs_campaign_idx on research_runs (campaign_id);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete set null,
  filename text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  row_count integer not null default 0,
  imported_count integer not null default 0,
  merged_count integer not null default 0,
  skipped_count integer not null default 0,
  rows jsonb not null default '[]',
  errors jsonb not null default '[]',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table worker_heartbeats (
  id text primary key,
  last_seen_at timestamptz not null default now(),
  info jsonb not null default '{}'
);

-- ── updated_at triggers ──────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['profiles', 'campaigns', 'businesses',
    'business_contacts', 'qualification_rules', 'outreach_drafts',
    'follow_up_tasks', 'research_tasks', 'import_jobs']
  loop
    execute format(
      'create trigger %I before update on %I
       for each row execute function set_updated_at()',
      t || '_updated_at', t);
  end loop;
end;
$$;

-- ── row level security ───────────────────────────────────────────────
-- Single-org MVP: any authenticated user has full access. Tenant separation
-- later means adding an org_id column + replacing these policies; nothing in
-- the schema prevents that.

do $$
declare t text;
begin
  foreach t in array array['profiles', 'campaigns', 'campaign_industries',
    'campaign_locations', 'businesses', 'business_sources',
    'business_contacts', 'website_pages', 'extracted_facts',
    'qualification_rules', 'qualification_runs', 'qualification_evidence',
    'pain_hypotheses', 'outreach_drafts', 'outreach_events',
    'follow_up_tasks', 'suppression_list', 'research_tasks',
    'research_runs', 'import_jobs', 'worker_heartbeats']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated
       using (true) with check (true)',
      t || '_authenticated_all', t);
  end loop;
end;
$$;
