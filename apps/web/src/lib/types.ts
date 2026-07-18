// Row types inferred from the Drizzle schema (single source of truth).
import type {
  businessContacts,
  businesses,
  BUSINESS_STATUSES,
  campaigns,
  extractedFacts,
  followUpTasks,
  outreachDrafts,
  painHypotheses,
  qualificationEvidence,
  qualificationRules,
  qualificationRuns,
  researchRuns,
  websitePages,
} from "@/db/schema";

export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const REJECTION_REASONS = [
  ["too_small", "Too small"],
  ["too_large", "Too large"],
  ["wrong_industry", "Wrong industry"],
  ["franchise_or_national", "Franchise or national company"],
  ["weak_evidence", "Weak evidence"],
  ["no_decision_maker", "No reachable decision-maker"],
  ["existing_software_sufficient", "Existing software appears sufficient"],
  ["duplicate", "Duplicate"],
  ["poor_fit", "Poor fit"],
  ["other", "Other"],
] as const;

export type Campaign = typeof campaigns.$inferSelect;
export type Business = typeof businesses.$inferSelect;
export type BusinessContact = typeof businessContacts.$inferSelect;
export type ExtractedFact = typeof extractedFacts.$inferSelect;
export type WebsitePage = typeof websitePages.$inferSelect;
export type QualificationRule = typeof qualificationRules.$inferSelect;
export type QualificationRun = typeof qualificationRuns.$inferSelect;
export type QualificationEvidence = typeof qualificationEvidence.$inferSelect;
export type PainHypothesis = typeof painHypotheses.$inferSelect;
export type OutreachDraft = typeof outreachDrafts.$inferSelect;
export type FollowUpTask = typeof followUpTasks.$inferSelect;
export type ResearchRun = typeof researchRuns.$inferSelect;

export type RunStats = Partial<
  Record<
    "queries" | "raw_results" | "skipped_aggregators" | "new_businesses" | "merged",
    number
  >
>;
