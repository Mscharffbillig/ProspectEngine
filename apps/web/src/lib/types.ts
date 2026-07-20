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

// Manual-correction inputs + allowed contact role types. Kept here (a plain
// module) rather than in the "use server" actions file, since a "use server"
// module can only expose async actions to client components — a value/const
// exported from it is not usable on the client.
export const CONTACT_ROLE_TYPES = [
  "owner",
  "founder",
  "general_manager",
  "operations_manager",
  "office_manager",
  "service_manager",
  "project_manager",
  "other",
  "unknown",
] as const;

export interface ProfileInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  industry: string;
  summary: string;
}

export interface ContactInput {
  id?: string;
  name: string;
  role: string;
  roleType: string;
  email: string;
  phone: string;
  isDecisionMaker: boolean;
}

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

export type ValidationCheck = { passed: boolean; detail: string };
export type ValidationChecks = Record<string, ValidationCheck>;

export const VALIDATION_CHECK_LABELS: Record<string, string> = {
  crawl: "Meaningful content",
  operating_business: "Operating business",
  industry: "Industry match",
  geography: "Geography match",
  identity: "Business identity",
  independent: "Independent (not franchise)",
};

export type RunStats = Partial<
  Record<
    "queries" | "raw_results" | "skipped_aggregators" | "new_businesses" | "merged",
    number
  >
>;
