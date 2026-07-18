CREATE TABLE "business_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text,
	"role" text,
	"role_type" text DEFAULT 'unknown' NOT NULL,
	"email" text,
	"email_source" text,
	"email_confidence" text,
	"phone" text,
	"source_url" text,
	"excerpt" text,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_contacts_role_type_check" CHECK (role_type in ('owner', 'founder', 'general_manager', 'operations_manager', 'office_manager', 'service_manager', 'project_manager', 'other', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "business_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"query" text,
	"title" text,
	"url" text,
	"snippet" text,
	"rank" integer,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_sources_type_check" CHECK (source_type in ('search_api', 'osm', 'csv_import', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website_url" text,
	"domain" text,
	"phone" text,
	"normalized_phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"industry" text,
	"summary" text,
	"employee_estimate" text,
	"status" text DEFAULT 'unresearched' NOT NULL,
	"score" integer,
	"last_action_at" timestamp with time zone,
	"next_action_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"rejection_reason" text,
	"loss_reason" text,
	"notes" text,
	"researched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_status_check" CHECK (status in ('unresearched', 'researching', 'research_failed', 'qualified', 'needs_review', 'approved', 'rejected', 'snoozed', 'ready_to_contact', 'contacted', 'replied', 'interview_scheduled', 'problem_identified', 'proposal_sent', 'pilot', 'won', 'lost', 'do_not_contact')),
	CONSTRAINT "businesses_rejection_reason_check" CHECK (rejection_reason is null or rejection_reason in ('too_small', 'too_large', 'wrong_industry', 'franchise_or_national', 'weak_evidence', 'no_decision_maker', 'existing_software_sufficient', 'duplicate', 'poor_fit', 'other'))
);
--> statement-breakpoint
CREATE TABLE "campaign_industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"industry" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"location" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"min_company_size" integer,
	"max_company_size" integer,
	"include_keywords" text[] DEFAULT '{}' NOT NULL,
	"exclude_keywords" text[] DEFAULT '{}' NOT NULL,
	"preferred_characteristics" text[] DEFAULT '{}' NOT NULL,
	"excluded_characteristics" text[] DEFAULT '{}' NOT NULL,
	"workflow_problems" text[] DEFAULT '{}' NOT NULL,
	"geography" text,
	"max_candidates_per_run" integer DEFAULT 50 NOT NULL,
	"min_qualification_score" integer DEFAULT 30 NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_status_check" CHECK (status in ('draft', 'active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "extracted_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"value" text NOT NULL,
	"confidence" text DEFAULT 'unknown' NOT NULL,
	"source_url" text,
	"excerpt" text,
	"method" text DEFAULT 'heuristic' NOT NULL,
	"page_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extracted_facts_confidence_check" CHECK (confidence in ('confirmed', 'high', 'medium', 'low', 'unknown')),
	CONSTRAINT "extracted_facts_method_check" CHECK (method in ('regex', 'heuristic', 'ai', 'import', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "follow_up_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"draft_id" uuid,
	"kind" text DEFAULT 'first_follow_up' NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_up_tasks_kind_check" CHECK (kind in ('first_follow_up', 'final_follow_up', 'custom')),
	CONSTRAINT "follow_up_tasks_status_check" CHECK (status in ('pending', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"filename" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"merged_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"contact_id" uuid,
	"subject" text,
	"body" text NOT NULL,
	"method" text DEFAULT 'template' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_drafts_method_check" CHECK (method in ('template', 'ai')),
	CONSTRAINT "outreach_drafts_status_check" CHECK (status in ('draft', 'approved', 'sent', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"draft_id" uuid,
	"event_type" text NOT NULL,
	"channel" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_events_type_check" CHECK (event_type in ('sent', 'reply', 'bounce', 'opt_out', 'note'))
);
--> statement-breakpoint
CREATE TABLE "pain_hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"question" text NOT NULL,
	"signal_key" text NOT NULL,
	"evidence" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"label" text NOT NULL,
	"points" integer NOT NULL,
	"evidence" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"label" text NOT NULL,
	"points" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualification_rules_rule_key_unique" UNIQUE("rule_key")
);
--> statement-breakpoint
CREATE TABLE "qualification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"total_score" integer NOT NULL,
	"scoring_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_runs_status_check" CHECK (status in ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "research_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_type" text NOT NULL,
	"campaign_id" uuid,
	"business_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"locked_by" text,
	"lock_expires_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_tasks_type_check" CHECK (task_type in ('discover_candidates', 'research_website', 'extract_facts', 'score_business', 'generate_hypotheses', 'generate_outreach_draft', 'process_csv_import')),
	CONSTRAINT "research_tasks_status_check" CHECK (status in ('pending', 'running', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text,
	"email" text,
	"phone" text,
	"company_name" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_list_any_field_check" CHECK (domain is not null or email is not null or phone is not null or company_name is not null)
);
--> statement-breakpoint
CREATE TABLE "website_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"http_status" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_text" text,
	"content_hash" text,
	"source_type" text DEFAULT 'crawl' NOT NULL,
	"crawl_allowed" boolean DEFAULT true NOT NULL,
	"extraction_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_sources" ADD CONSTRAINT "business_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_industries" ADD CONSTRAINT "campaign_industries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_locations" ADD CONSTRAINT "campaign_locations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_facts" ADD CONSTRAINT "extracted_facts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_facts" ADD CONSTRAINT "extracted_facts_page_id_website_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."website_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_draft_id_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."outreach_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_contact_id_business_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."business_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_draft_id_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."outreach_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pain_hypotheses" ADD CONSTRAINT "pain_hypotheses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_evidence" ADD CONSTRAINT "qualification_evidence_run_id_qualification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."qualification_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_runs" ADD CONSTRAINT "qualification_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_contacts_business_idx" ON "business_contacts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "business_sources_business_idx" ON "business_sources" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_sources_osm_key" ON "business_sources" USING btree ("source_ref") WHERE source_type = 'osm' and source_ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_domain_key" ON "businesses" USING btree ("domain") WHERE domain is not null;--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "businesses_campaign_idx" ON "businesses" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "businesses_normalized_name_idx" ON "businesses" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_industries_unique" ON "campaign_industries" USING btree ("campaign_id","industry");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_locations_unique" ON "campaign_locations" USING btree ("campaign_id","location");--> statement-breakpoint
CREATE INDEX "extracted_facts_business_idx" ON "extracted_facts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "extracted_facts_key_idx" ON "extracted_facts" USING btree ("fact_key");--> statement-breakpoint
CREATE INDEX "follow_up_tasks_due_idx" ON "follow_up_tasks" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "outreach_drafts_business_idx" ON "outreach_drafts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "outreach_drafts_status_idx" ON "outreach_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outreach_events_business_idx" ON "outreach_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "pain_hypotheses_business_idx" ON "pain_hypotheses" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "qualification_evidence_run_idx" ON "qualification_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "qualification_runs_business_idx" ON "qualification_runs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "research_runs_campaign_idx" ON "research_runs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "research_tasks_claim_idx" ON "research_tasks" USING btree ("status","scheduled_at","priority");--> statement-breakpoint
CREATE INDEX "research_tasks_business_idx" ON "research_tasks" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_domain_key" ON "suppression_list" USING btree (lower(domain)) WHERE domain is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_email_key" ON "suppression_list" USING btree (lower(email)) WHERE email is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "website_pages_business_url_key" ON "website_pages" USING btree ("business_id","url");