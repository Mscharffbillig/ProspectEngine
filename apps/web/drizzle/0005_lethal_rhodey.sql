CREATE TABLE "enrichment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"contact_readiness" text,
	"force" boolean DEFAULT false NOT NULL,
	"stages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_analysis" jsonb,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_runs_status_check" CHECK (status in ('running', 'completed', 'partial', 'failed', 'skipped')),
	CONSTRAINT "enrichment_runs_readiness_check" CHECK (contact_readiness is null or contact_readiness in ('ready_direct', 'ready_general', 'needs_contact_enrichment', 'needs_manual_verification', 'not_contactable'))
);
--> statement-breakpoint
CREATE TABLE "external_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text,
	"role" text,
	"role_type" text DEFAULT 'unknown' NOT NULL,
	"company_association" text,
	"email" text,
	"email_type" text,
	"source" text NOT NULL,
	"provider" text,
	"source_url" text,
	"excerpt" text,
	"confidence" text,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"method" text DEFAULT 'search' NOT NULL,
	"provider_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_contacts_role_type_check" CHECK (role_type in ('owner', 'founder', 'general_manager', 'operations_manager', 'office_manager', 'service_manager', 'project_manager', 'registered_agent', 'other', 'unknown')),
	CONSTRAINT "external_contacts_verification_check" CHECK (verification_state in ('confirmed', 'likely', 'unverified', 'conflicting', 'rejected')),
	CONSTRAINT "external_contacts_email_type_check" CHECK (email_type is null or email_type in ('website_published', 'provider_verified', 'provider_suggested', 'generic', 'pattern_unverified'))
);
--> statement-breakpoint
CREATE TABLE "external_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"query" text,
	"title" text,
	"url" text,
	"domain" text,
	"snippet" text,
	"evidence_type" text DEFAULT 'search_result' NOT NULL,
	"confidence" text,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_evidence_verification_check" CHECK (verification_state in ('confirmed', 'likely', 'unverified', 'conflicting', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "provider_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"success" boolean DEFAULT false NOT NULL,
	"error" text,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_tasks" DROP CONSTRAINT "research_tasks_type_check";--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_contacts" ADD CONSTRAINT "external_contacts_run_id_enrichment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_contacts" ADD CONSTRAINT "external_contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_evidence" ADD CONSTRAINT "external_evidence_run_id_enrichment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_evidence" ADD CONSTRAINT "external_evidence_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_run_id_enrichment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_runs_business_idx" ON "enrichment_runs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "external_contacts_run_idx" ON "external_contacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "external_contacts_business_idx" ON "external_contacts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "external_evidence_run_idx" ON "external_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "external_evidence_business_idx" ON "external_evidence" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "provider_usage_run_idx" ON "provider_usage" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_type_check" CHECK (task_type in ('discover_candidates', 'research_website', 'extract_facts', 'score_business', 'generate_hypotheses', 'generate_outreach_draft', 'process_csv_import', 'enrich_lead'));