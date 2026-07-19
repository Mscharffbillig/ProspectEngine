-- Scoring v2.0 rule data: evidence-confidence requirements, evidence
-- categories, and de-weighted contactability. Rules are data, so this is a
-- data migration rather than a schema change.
UPDATE qualification_rules SET
  points = 3,
  definition = definition || '{"category": "contactability", "min_confidence": "medium"}'::jsonb
WHERE rule_key = 'public_contact';
--> statement-breakpoint
UPDATE qualification_rules SET
  definition = definition || '{"category": "workflow", "min_confidence": "high"}'::jsonb
WHERE rule_key IN ('multiple_crews', 'multiple_service_areas', 'manual_forms',
                   'hiring_coordination', 'equipment_heavy');
--> statement-breakpoint
UPDATE qualification_rules SET
  definition = definition || '{"category": "fit", "min_confidence": "high"}'::jsonb
WHERE rule_key IN ('commercial_or_recurring', 'independent_business');
--> statement-breakpoint
UPDATE qualification_rules SET
  definition = definition || '{"category": "fit", "min_confidence": "high"}'::jsonb
WHERE rule_key = 'identifiable_decision_maker';
--> statement-breakpoint
UPDATE qualification_rules SET
  definition = definition || '{"category": "eligibility", "min_confidence": "medium"}'::jsonb
WHERE rule_key IN ('national_or_franchise', 'solo_operator', 'no_web_presence',
                   'sophisticated_software');
