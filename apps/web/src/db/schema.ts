// Source of truth for the database schema (drizzle-kit generates SQL
// migrations from this file into apps/web/drizzle/).
//
// Statuses/reasons are text + CHECK constraints (not pg enums) so new values
// are data-only changes. Users live in Neon Auth's neon_auth.users_sync table;
// the app schema carries no user table of its own (single-org MVP).
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const BUSINESS_STATUSES = [
  "unresearched",
  "researching",
  "research_failed",
  "qualified",
  "needs_review",
  "approved",
  "rejected",
  "snoozed",
  "ready_to_contact",
  "contacted",
  "replied",
  "interview_scheduled",
  "problem_identified",
  "proposal_sent",
  "pilot",
  "won",
  "lost",
  "do_not_contact",
] as const;

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

// ── campaigns ────────────────────────────────────────────────────────

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    minCompanySize: integer("min_company_size"),
    maxCompanySize: integer("max_company_size"),
    includeKeywords: text("include_keywords").array().notNull().default([]),
    excludeKeywords: text("exclude_keywords").array().notNull().default([]),
    preferredCharacteristics: text("preferred_characteristics").array().notNull().default([]),
    excludedCharacteristics: text("excluded_characteristics").array().notNull().default([]),
    workflowProblems: text("workflow_problems").array().notNull().default([]),
    geography: text("geography"),
    maxCandidatesPerRun: integer("max_candidates_per_run").notNull().default(50),
    minQualificationScore: integer("min_qualification_score").notNull().default(30),
    aiEnabled: boolean("ai_enabled").notNull().default(false),
    status: text("status").notNull().default("active"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("campaigns_status_check", inList("status", ["draft", "active", "paused", "archived"])),
  ],
);

export const campaignIndustries = pgTable(
  "campaign_industries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    industry: text("industry").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("campaign_industries_unique").on(t.campaignId, t.industry)],
);

export const campaignLocations = pgTable(
  "campaign_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    location: text("location").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("campaign_locations_unique").on(t.campaignId, t.location)],
);

// ── businesses ───────────────────────────────────────────────────────

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    websiteUrl: text("website_url"),
    domain: text("domain"),
    phone: text("phone"),
    normalizedPhone: text("normalized_phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    industry: text("industry"),
    summary: text("summary"),
    employeeEstimate: text("employee_estimate"),
    // Canonical-name resolution ("manual" edits are never overwritten).
    nameConfidence: text("name_confidence").default("low"),
    nameSource: text("name_source"),
    // Hard-gate validation outcome (separate from the numeric score).
    validationStatus: text("validation_status").notNull().default("pending_validation"),
    validationReasons: jsonb("validation_reasons").notNull().default([]),
    validationChecks: jsonb("validation_checks").notNull().default({}),
    status: text("status").notNull().default("unresearched"),
    score: integer("score"),
    lastActionAt: timestamp("last_action_at", { withTimezone: true }),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    lossReason: text("loss_reason"),
    notes: text("notes"),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("businesses_status_check", inList("status", BUSINESS_STATUSES)),
    check(
      "businesses_validation_status_check",
      inList("validation_status", [
        "pending_validation",
        "valid",
        "invalid",
        "ambiguous",
        "manual_review_required",
      ]),
    ),
    check(
      "businesses_rejection_reason_check",
      sql.raw(
        "rejection_reason is null or rejection_reason in ('too_small', 'too_large', " +
          "'wrong_industry', 'franchise_or_national', 'weak_evidence', 'no_decision_maker', " +
          "'existing_software_sufficient', 'duplicate', 'poor_fit', 'other')",
      ),
    ),
    uniqueIndex("businesses_domain_key").on(t.domain).where(sql`domain is not null`),
    index("businesses_status_idx").on(t.status),
    index("businesses_campaign_idx").on(t.campaignId),
    index("businesses_normalized_name_idx").on(t.normalizedName),
  ],
);

export const businessSources = pgTable(
  "business_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref"),
    query: text("query"),
    title: text("title"),
    url: text("url"),
    snippet: text("snippet"),
    rank: integer("rank"),
    raw: jsonb("raw"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "business_sources_type_check",
      inList("source_type", ["search_api", "osm", "csv_import", "manual"]),
    ),
    index("business_sources_business_idx").on(t.businessId),
    uniqueIndex("business_sources_osm_key")
      .on(t.sourceRef)
      .where(sql`source_type = 'osm' and source_ref is not null`),
  ],
);

export const businessContacts = pgTable(
  "business_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name"),
    role: text("role"),
    roleType: text("role_type").notNull().default("unknown"),
    email: text("email"),
    emailSource: text("email_source"),
    emailConfidence: text("email_confidence"),
    phone: text("phone"),
    sourceUrl: text("source_url"),
    excerpt: text("excerpt"),
    isDecisionMaker: boolean("is_decision_maker").notNull().default(false),
    method: text("method").notNull().default("auto"), // auto contacts are replaced on reprocess
    nameConfidence: text("name_confidence"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "business_contacts_role_type_check",
      inList("role_type", [
        "owner",
        "founder",
        "general_manager",
        "operations_manager",
        "office_manager",
        "service_manager",
        "project_manager",
        "other",
        "unknown",
      ]),
    ),
    index("business_contacts_business_idx").on(t.businessId),
  ],
);

// ── research artifacts ───────────────────────────────────────────────

export const websitePages = pgTable(
  "website_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    httpStatus: integer("http_status"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    contentText: text("content_text"),
    contentHash: text("content_hash"),
    sourceType: text("source_type").notNull().default("crawl"),
    crawlAllowed: boolean("crawl_allowed").notNull().default(true),
    extractionMeta: jsonb("extraction_meta"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("website_pages_business_url_key").on(t.businessId, t.url)],
);

export const extractedFacts = pgTable(
  "extracted_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    value: text("value").notNull(),
    confidence: text("confidence").notNull().default("unknown"),
    sourceUrl: text("source_url"),
    excerpt: text("excerpt"),
    method: text("method").notNull().default("heuristic"),
    pageId: uuid("page_id").references(() => websitePages.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "extracted_facts_confidence_check",
      inList("confidence", ["confirmed", "high", "medium", "low", "unknown"]),
    ),
    check(
      "extracted_facts_method_check",
      inList("method", ["regex", "heuristic", "ai", "import", "manual"]),
    ),
    index("extracted_facts_business_idx").on(t.businessId),
    index("extracted_facts_key_idx").on(t.factKey),
  ],
);

// ── qualification ────────────────────────────────────────────────────

export const qualificationRules = pgTable("qualification_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleKey: text("rule_key").notNull().unique(),
  label: text("label").notNull(),
  points: integer("points").notNull(),
  active: boolean("active").notNull().default(true),
  definition: jsonb("definition").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const qualificationRuns = pgTable(
  "qualification_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    totalScore: integer("total_score").notNull(),
    scoringVersion: text("scoring_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("qualification_runs_business_idx").on(t.businessId)],
);

export const qualificationEvidence = pgTable(
  "qualification_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => qualificationRuns.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    label: text("label").notNull(),
    points: integer("points").notNull(),
    evidence: text("evidence"),
    sourceUrl: text("source_url"),
    confidence: text("confidence"),
    createdAt: createdAt(),
  },
  (t) => [index("qualification_evidence_run_idx").on(t.runId)],
);

export const painHypotheses = pgTable(
  "pain_hypotheses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    signalKey: text("signal_key").notNull(),
    evidence: text("evidence"),
    sourceUrl: text("source_url"),
    createdAt: createdAt(),
  },
  (t) => [index("pain_hypotheses_business_idx").on(t.businessId)],
);

// ── outreach ─────────────────────────────────────────────────────────

export const outreachDrafts = pgTable(
  "outreach_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => businessContacts.id, {
      onDelete: "set null",
    }),
    subject: text("subject"),
    body: text("body").notNull(),
    method: text("method").notNull().default("template"),
    status: text("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    channel: text("channel"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("outreach_drafts_method_check", inList("method", ["template", "ai"])),
    check(
      "outreach_drafts_status_check",
      inList("status", ["draft", "approved", "sent", "discarded"]),
    ),
    index("outreach_drafts_business_idx").on(t.businessId),
    index("outreach_drafts_status_idx").on(t.status),
  ],
);

export const outreachEvents = pgTable(
  "outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").references(() => outreachDrafts.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    channel: text("channel"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "outreach_events_type_check",
      inList("event_type", ["sent", "reply", "bounce", "opt_out", "note"]),
    ),
    index("outreach_events_business_idx").on(t.businessId),
  ],
);

export const followUpTasks = pgTable(
  "follow_up_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").references(() => outreachDrafts.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("first_follow_up"),
    dueDate: date("due_date").notNull(),
    status: text("status").notNull().default("pending"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "follow_up_tasks_kind_check",
      inList("kind", ["first_follow_up", "final_follow_up", "custom"]),
    ),
    check("follow_up_tasks_status_check", inList("status", ["pending", "done", "cancelled"])),
    index("follow_up_tasks_due_idx").on(t.status, t.dueDate),
  ],
);

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: text("domain"),
    email: text("email"),
    phone: text("phone"),
    companyName: text("company_name"),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "suppression_list_any_field_check",
      sql`domain is not null or email is not null or phone is not null or company_name is not null`,
    ),
    uniqueIndex("suppression_domain_key")
      .on(sql`lower(domain)`)
      .where(sql`domain is not null`),
    uniqueIndex("suppression_email_key")
      .on(sql`lower(email)`)
      .where(sql`email is not null`),
  ],
);

// ── background jobs ──────────────────────────────────────────────────

export const researchTasks = pgTable(
  "research_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskType: text("task_type").notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    lockedBy: text("locked_by"),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "research_tasks_type_check",
      inList("task_type", [
        "discover_candidates",
        "research_website",
        "extract_facts",
        "score_business",
        "generate_hypotheses",
        "generate_outreach_draft",
        "process_csv_import",
      ]),
    ),
    check(
      "research_tasks_status_check",
      inList("status", ["pending", "running", "done", "failed", "cancelled"]),
    ),
    index("research_tasks_claim_idx").on(t.status, t.scheduledAt, t.priority),
    index("research_tasks_business_idx").on(t.businessId),
  ],
);

export const researchRuns = pgTable(
  "research_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    check("research_runs_status_check", inList("status", ["running", "completed", "failed"])),
    index("research_runs_campaign_idx").on(t.campaignId),
  ],
);

export const importJobs = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  filename: text("filename"),
  status: text("status").notNull().default("pending"),
  rowCount: integer("row_count").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  mergedCount: integer("merged_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  rows: jsonb("rows").notNull().default([]),
  errors: jsonb("errors").notNull().default([]),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: text("id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  info: jsonb("info").notNull().default({}),
});

// ── relations (for db.query.*.findMany({ with: ... })) ───────────────

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  industries: many(campaignIndustries),
  locations: many(campaignLocations),
  businesses: many(businesses),
  researchRuns: many(researchRuns),
}));

export const campaignIndustriesRelations = relations(campaignIndustries, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignIndustries.campaignId],
    references: [campaigns.id],
  }),
}));

export const campaignLocationsRelations = relations(campaignLocations, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignLocations.campaignId],
    references: [campaigns.id],
  }),
}));

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [businesses.campaignId], references: [campaigns.id] }),
  contacts: many(businessContacts),
  sources: many(businessSources),
  pages: many(websitePages),
  facts: many(extractedFacts),
  qualificationRuns: many(qualificationRuns),
  hypotheses: many(painHypotheses),
  drafts: many(outreachDrafts),
}));

export const businessSourcesRelations = relations(businessSources, ({ one }) => ({
  business: one(businesses, {
    fields: [businessSources.businessId],
    references: [businesses.id],
  }),
}));

export const businessContactsRelations = relations(businessContacts, ({ one }) => ({
  business: one(businesses, {
    fields: [businessContacts.businessId],
    references: [businesses.id],
  }),
}));

export const websitePagesRelations = relations(websitePages, ({ one }) => ({
  business: one(businesses, { fields: [websitePages.businessId], references: [businesses.id] }),
}));

export const extractedFactsRelations = relations(extractedFacts, ({ one }) => ({
  business: one(businesses, { fields: [extractedFacts.businessId], references: [businesses.id] }),
}));

export const qualificationRunsRelations = relations(qualificationRuns, ({ one, many }) => ({
  business: one(businesses, {
    fields: [qualificationRuns.businessId],
    references: [businesses.id],
  }),
  evidence: many(qualificationEvidence),
}));

export const qualificationEvidenceRelations = relations(qualificationEvidence, ({ one }) => ({
  run: one(qualificationRuns, {
    fields: [qualificationEvidence.runId],
    references: [qualificationRuns.id],
  }),
}));

export const painHypothesesRelations = relations(painHypotheses, ({ one }) => ({
  business: one(businesses, { fields: [painHypotheses.businessId], references: [businesses.id] }),
}));

export const outreachDraftsRelations = relations(outreachDrafts, ({ one }) => ({
  business: one(businesses, { fields: [outreachDrafts.businessId], references: [businesses.id] }),
  contact: one(businessContacts, {
    fields: [outreachDrafts.contactId],
    references: [businessContacts.id],
  }),
}));

export const followUpTasksRelations = relations(followUpTasks, ({ one }) => ({
  business: one(businesses, { fields: [followUpTasks.businessId], references: [businesses.id] }),
  draft: one(outreachDrafts, {
    fields: [followUpTasks.draftId],
    references: [outreachDrafts.id],
  }),
}));

export const researchRunsRelations = relations(researchRuns, ({ one }) => ({
  campaign: one(campaigns, { fields: [researchRuns.campaignId], references: [campaigns.id] }),
}));
