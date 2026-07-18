"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  campaignIndustries,
  campaignLocations,
  campaigns,
  researchRuns,
  researchTasks,
} from "@/db/schema";
import { campaignSchema, toList } from "@/lib/schemas";

function parseCampaignForm(formData: FormData) {
  return campaignSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    industries: toList(formData.get("industries")),
    locations: toList(formData.get("locations")),
    min_company_size: formData.get("min_company_size") || null,
    max_company_size: formData.get("max_company_size") || null,
    include_keywords: toList(formData.get("include_keywords")),
    exclude_keywords: toList(formData.get("exclude_keywords")),
    preferred_characteristics: toList(formData.get("preferred_characteristics")),
    excluded_characteristics: toList(formData.get("excluded_characteristics")),
    workflow_problems: toList(formData.get("workflow_problems")),
    geography: formData.get("geography") ?? "",
    max_candidates_per_run: formData.get("max_candidates_per_run") || 50,
    min_qualification_score: formData.get("min_qualification_score") || 30,
    ai_enabled: formData.get("ai_enabled") === "on",
    status: formData.get("status") ?? "active",
  });
}

function campaignColumns(input: ReturnType<typeof campaignSchema.parse>) {
  return {
    name: input.name,
    description: input.description || null,
    minCompanySize: input.min_company_size ?? null,
    maxCompanySize: input.max_company_size ?? null,
    includeKeywords: input.include_keywords,
    excludeKeywords: input.exclude_keywords,
    preferredCharacteristics: input.preferred_characteristics,
    excludedCharacteristics: input.excluded_characteristics,
    workflowProblems: input.workflow_problems,
    geography: input.geography || null,
    maxCandidatesPerRun: input.max_candidates_per_run,
    minQualificationScore: input.min_qualification_score,
    aiEnabled: input.ai_enabled,
    status: input.status,
  };
}

async function syncListTables(campaignId: string, industries: string[], locations: string[]) {
  await db().delete(campaignIndustries).where(eq(campaignIndustries.campaignId, campaignId));
  await db().delete(campaignLocations).where(eq(campaignLocations.campaignId, campaignId));
  if (industries.length > 0) {
    await db()
      .insert(campaignIndustries)
      .values(industries.map((industry) => ({ campaignId, industry })));
  }
  if (locations.length > 0) {
    await db()
      .insert(campaignLocations)
      .values(locations.map((location) => ({ campaignId, location })));
  }
}

export async function createCampaign(
  _prev: { error: string } | { ok: true } | null,
  formData: FormData,
): Promise<{ error: string } | { ok: true } | null> {
  const parsed = parseCampaignForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors.map((e) => e.message).join("; ") };
  }
  let campaignId: string;
  try {
    const [row] = await db()
      .insert(campaigns)
      .values(campaignColumns(parsed.data))
      .returning({ id: campaigns.id });
    if (!row) return { error: "Insert failed" };
    campaignId = row.id;
    await syncListTables(campaignId, parsed.data.industries, parsed.data.locations);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Insert failed" };
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}`);
}

export async function updateCampaign(
  campaignId: string,
  _prev: { error: string } | { ok: true } | null,
  formData: FormData,
): Promise<{ error: string } | { ok: true }> {
  const parsed = parseCampaignForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors.map((e) => e.message).join("; ") };
  }
  try {
    await db()
      .update(campaigns)
      .set(campaignColumns(parsed.data))
      .where(eq(campaigns.id, campaignId));
    await syncListTables(campaignId, parsed.data.industries, parsed.data.locations);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function runCampaign(campaignId: string): Promise<void> {
  const [run] = await db()
    .insert(researchRuns)
    .values({ campaignId })
    .returning({ id: researchRuns.id });
  if (!run) throw new Error("Could not create research run");
  await db().insert(researchTasks).values({
    taskType: "discover_candidates",
    campaignId,
    priority: 10,
    payload: { research_run_id: run.id },
  });
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function setCampaignStatus(
  campaignId: string,
  status: "active" | "paused" | "archived",
): Promise<void> {
  await db().update(campaigns).set({ status }).where(eq(campaigns.id, campaignId));
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
}
