CREATE TABLE "validation_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"previous_status" text NOT NULL,
	"failed_gates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"overridden_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "validation_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qualification_evidence" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "qualification_evidence" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "validation_overrides" ADD CONSTRAINT "validation_overrides_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "validation_overrides_business_idx" ON "validation_overrides" USING btree ("business_id");