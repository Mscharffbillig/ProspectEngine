ALTER TABLE "business_contacts" ADD COLUMN "method" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_contacts" ADD COLUMN "name_confidence" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "name_confidence" text DEFAULT 'low';--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "name_source" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "validation_status" text DEFAULT 'pending_validation' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "validation_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "validation_checks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "qualification_evidence" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_validation_status_check" CHECK (validation_status in ('pending_validation', 'valid', 'invalid', 'ambiguous', 'manual_review_required'));