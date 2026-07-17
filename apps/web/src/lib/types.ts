// Row types for the tables the UI reads. Kept manually in sync with
// supabase/migrations; only fields the UI uses are declared.

export type BusinessStatus =
  | "unresearched"
  | "researching"
  | "research_failed"
  | "qualified"
  | "needs_review"
  | "approved"
  | "rejected"
  | "snoozed"
  | "ready_to_contact"
  | "contacted"
  | "replied"
  | "interview_scheduled"
  | "problem_identified"
  | "proposal_sent"
  | "pilot"
  | "won"
  | "lost"
  | "do_not_contact";

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

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  min_company_size: number | null;
  max_company_size: number | null;
  include_keywords: string[];
  exclude_keywords: string[];
  preferred_characteristics: string[];
  excluded_characteristics: string[];
  workflow_problems: string[];
  geography: string | null;
  max_candidates_per_run: number;
  min_qualification_score: number;
  ai_enabled: boolean;
  status: "draft" | "active" | "paused" | "archived";
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface Business {
  id: string;
  campaign_id: string | null;
  name: string;
  website_url: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  summary: string | null;
  status: BusinessStatus;
  score: number | null;
  last_action_at: string | null;
  next_action_at: string | null;
  snoozed_until: string | null;
  rejection_reason: string | null;
  notes: string | null;
  researched_at: string | null;
  created_at: string;
}

export interface BusinessContact {
  id: string;
  business_id: string;
  name: string | null;
  role: string | null;
  role_type: string;
  email: string | null;
  email_source: string | null;
  email_confidence: string | null;
  phone: string | null;
  source_url: string | null;
  excerpt: string | null;
  is_decision_maker: boolean;
}

export interface ExtractedFact {
  id: string;
  fact_key: string;
  value: string;
  confidence: string;
  source_url: string | null;
  excerpt: string | null;
  method: string;
}

export interface WebsitePage {
  id: string;
  url: string;
  title: string | null;
  http_status: number | null;
  fetched_at: string;
  crawl_allowed: boolean;
}

export interface QualificationEvidence {
  id: string;
  rule_key: string;
  label: string;
  points: number;
  evidence: string | null;
  source_url: string | null;
}

export interface QualificationRun {
  id: string;
  total_score: number;
  scoring_version: string;
  created_at: string;
  qualification_evidence: QualificationEvidence[];
}

export interface PainHypothesis {
  id: string;
  question: string;
  signal_key: string;
  evidence: string | null;
  source_url: string | null;
}

export interface OutreachDraft {
  id: string;
  business_id: string;
  subject: string | null;
  body: string;
  method: string;
  status: "draft" | "approved" | "sent" | "discarded";
  sent_at: string | null;
  channel: string | null;
  created_at: string;
}

export interface FollowUpTask {
  id: string;
  business_id: string;
  kind: string;
  due_date: string;
  status: "pending" | "done" | "cancelled";
}

export interface ResearchRun {
  id: string;
  campaign_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  stats: Record<string, number>;
  error: string | null;
}

export interface QualificationRule {
  id: string;
  rule_key: string;
  label: string;
  points: number;
  active: boolean;
}
