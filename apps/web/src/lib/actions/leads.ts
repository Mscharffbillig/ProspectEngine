"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidateLeadPages(businessId: string) {
  revalidatePath("/review");
  revalidatePath("/outreach");
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
}

export async function approveLead(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({ status: "approved", last_action_at: new Date().toISOString() })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  // Approval immediately queues an outreach draft so the lead is actionable.
  await supabase.from("research_tasks").insert({
    task_type: "generate_outreach_draft",
    business_id: businessId,
  });
  revalidateLeadPages(businessId);
}

export async function rejectLead(businessId: string, reason: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({
      status: "rejected",
      rejection_reason: reason,
      last_action_at: new Date().toISOString(),
    })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  await cancelFollowUps(supabase, businessId);
  revalidateLeadPages(businessId);
}

export async function snoozeLead(businessId: string, days: number): Promise<void> {
  const supabase = await createClient();
  const until = new Date();
  until.setDate(until.getDate() + days);
  const { error } = await supabase
    .from("businesses")
    .update({
      status: "snoozed",
      snoozed_until: until.toISOString(),
      next_action_at: until.toISOString(),
      last_action_at: new Date().toISOString(),
    })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  revalidateLeadPages(businessId);
}

export async function setLeadStatus(businessId: string, status: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({ status, last_action_at: new Date().toISOString() })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  if (["lost", "do_not_contact"].includes(status)) {
    await cancelFollowUps(supabase, businessId);
  }
  revalidateLeadPages(businessId);
}

export async function saveLeadNotes(businessId: string, formData: FormData): Promise<void> {
  const notes = formData.get("notes");
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({ notes: typeof notes === "string" ? notes : null })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  revalidateLeadPages(businessId);
}

export async function requestDraft(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("research_tasks").insert({
    task_type: "generate_outreach_draft",
    business_id: businessId,
  });
  if (error) throw new Error(error.message);
  revalidateLeadPages(businessId);
}

export async function requestResearch(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("research_tasks").insert({
    task_type: "research_website",
    business_id: businessId,
  });
  if (error) throw new Error(error.message);
  revalidateLeadPages(businessId);
}

async function cancelFollowUps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
) {
  await supabase
    .from("follow_up_tasks")
    .update({ status: "cancelled" })
    .eq("business_id", businessId)
    .eq("status", "pending");
}
