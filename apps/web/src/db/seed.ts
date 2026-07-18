// Seeds scoring rules + the example campaign. Idempotent: skips anything
// already present. Run with: npm run db:seed
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const RULES: { ruleKey: string; label: string; points: number }[] = [
  { ruleKey: "identifiable_decision_maker", label: "Identifiable owner or operations manager", points: 10 },
  { ruleKey: "multiple_crews", label: "Multiple employees or crews", points: 15 },
  { ruleKey: "multiple_service_areas", label: "Multiple service areas or locations", points: 10 },
  { ruleKey: "commercial_or_recurring", label: "Commercial or recurring work", points: 10 },
  { ruleKey: "manual_forms", label: "Visible manual forms or disconnected processes", points: 10 },
  { ruleKey: "hiring_coordination", label: "Hiring office, dispatch, or coordination staff", points: 10 },
  { ruleKey: "public_contact", label: "Public contact method found", points: 10 },
  { ruleKey: "independent_business", label: "Independent business", points: 10 },
  { ruleKey: "equipment_heavy", label: "Equipment-heavy or coordination-heavy operation", points: 5 },
  { ruleKey: "national_or_franchise", label: "National company or franchise", points: -25 },
  { ruleKey: "solo_operator", label: "Likely solo operator", points: -15 },
  { ruleKey: "no_web_presence", label: "No meaningful web presence", points: -5 },
  { ruleKey: "sophisticated_software", label: "Clearly sophisticated integrated software operation", points: -10 },
];

// Fall back to the repo-root .env (shared with the Python worker).
const rootEnv = path.resolve(__dirname, "..", "..", "..", "..", ".env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf-8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && match[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2] ?? "";
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(url), { schema });

  await db
    .insert(schema.qualificationRules)
    .values(RULES.map((r) => ({ ...r, definition: { signal: r.ruleKey } })))
    .onConflictDoNothing({ target: schema.qualificationRules.ruleKey });

  const existing = await db.query.campaigns.findFirst();
  if (existing) {
    console.log("Campaign already present; rules ensured. Done.");
    return;
  }

  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      name: "Minnesota Trade Businesses",
      description:
        "Independent trade and service businesses in Minnesota and western Wisconsin that likely coordinate crews, equipment, and customers with manual processes.",
      minCompanySize: 5,
      maxCompanySize: 50,
      includeKeywords: ["multiple crews", "commercial", "service area", "independently owned"],
      excludeKeywords: ["national", "franchise", "solo operator"],
      preferredCharacteristics: [
        "Multiple crews",
        "Commercial work",
        "Multiple service areas",
        "Independently owned",
      ],
      excludedCharacteristics: ["National companies", "Franchises", "Solo operators"],
      workflowProblems: [
        "Dispatch and scheduling",
        "Estimate follow-up",
        "Jobsite documentation",
        "Equipment tracking",
        "Employee time collection",
        "Customer communication",
        "Repetitive data entry",
      ],
      geography: "Minnesota and western Wisconsin",
      maxCandidatesPerRun: 50,
      minQualificationScore: 30,
      status: "active",
    })
    .returning({ id: schema.campaigns.id });
  if (!campaign) throw new Error("Campaign insert returned no row");

  await db.insert(schema.campaignIndustries).values(
    [
      "Excavation",
      "HVAC",
      "Plumbing",
      "Landscaping",
      "Restoration",
      "Commercial cleaning",
      "Equipment repair",
      "Small manufacturing",
    ].map((industry) => ({ campaignId: campaign.id, industry })),
  );
  await db.insert(schema.campaignLocations).values(
    ["Minnesota", "Western Wisconsin"].map((location) => ({
      campaignId: campaign.id,
      location,
    })),
  );
  console.log("Seeded scoring rules and example campaign.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
