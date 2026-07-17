"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    min_company_size: input.min_company_size,
    max_company_size: input.max_company_size,
    include_keywords: input.include_keywords,
    exclude_keywords: input.exclude_keywords,
    preferred_characteristics: input.preferred_characteristics,
    excluded_characteristics: input.excluded_characteristics,
    workflow_problems: input.workflow_problems,
    geography: input.geography || null,
    max_candidates_per_run: input.max_candidates_per_run,
    min_qualification_score: input.min_qualification_score,
    ai_enabled: input.ai_enabled,
    status: input.status,
  };
}

async function syncListTable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "campaign_industries" | "campaign_locations",
  column: "industry" | "location",
  campaignId: string,
  values: string[],
) {
  await supabase.from(table).delete().eq("campaign_id", campaignId);
  if (values.length > 0) {
    const { error } = await supabase
      .from(table)
      .insert(values.map((v) => ({ campaign_id: campaignId, [column]: v })));
    if (error) throw new Error(`Failed to save ${column} list: ${error.message}`);
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert(campaignColumns(parsed.data))
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  await syncListTable(supabase, "campaign_industries", "industry", data.id, parsed.data.industries);
  await syncListTable(supabase, "campaign_locations", "location", data.id, parsed.data.locations);

  revalidatePath("/campaigns");
  redirect(`/campaigns/${data.id}`);
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update(campaignColumns(parsed.data))
    .eq("id", campaignId);
  if (error) return { error: error.message };

  await syncListTable(
    supabase,
    "campaign_industries",
    "industry",
    campaignId,
    parsed.data.industries,
  );
  await syncListTable(supabase, "campaign_locations", "location", campaignId, parsed.data.locations);

  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function runCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient();
  const { data: run, error: runError } = await supabase
    .from("research_runs")
    .insert({ campaign_id: campaignId })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message ?? "Could not create research run");

  const { error } = await supabase.from("research_tasks").insert({
    task_type: "discover_candidates",
    campaign_id: campaignId,
    priority: 10,
    payload: { research_run_id: run.id },
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function setCampaignStatus(
  campaignId: string,
  status: "active" | "paused" | "archived",
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ status }).eq("id", campaignId);
  if (error) throw new Error(error.message);
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
}
