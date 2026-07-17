"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const FIRST_FOLLOW_UP_DAYS = 4;
const FINAL_FOLLOW_UP_DAYS = 10;

function revalidateOutreach(businessId: string) {
  revalidatePath("/outreach");
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
}

/** Mark a draft as manually sent; schedules the 4-day and 10-day follow-ups. */
export async function markDraftSent(
  draftId: string,
  businessId: string,
  channel: string,
): Promise<void> {
  const supabase = await createClient();
  const now = new Date();
  const { error } = await supabase
    .from("outreach_drafts")
    .update({ status: "sent", sent_at: now.toISOString(), channel })
    .eq("id", draftId);
  if (error) throw new Error(error.message);

  await supabase.from("outreach_events").insert({
    business_id: businessId,
    draft_id: draftId,
    event_type: "sent",
    channel,
  });
  await supabase
    .from("businesses")
    .update({ status: "contacted", last_action_at: now.toISOString() })
    .eq("id", businessId);

  const due = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const { error: followUpError } = await supabase.from("follow_up_tasks").insert([
    {
      business_id: businessId,
      draft_id: draftId,
      kind: "first_follow_up",
      due_date: due(FIRST_FOLLOW_UP_DAYS),
    },
    {
      business_id: businessId,
      draft_id: draftId,
      kind: "final_follow_up",
      due_date: due(FINAL_FOLLOW_UP_DAYS),
    },
  ]);
  if (followUpError) throw new Error(followUpError.message);
  revalidateOutreach(businessId);
}

/** Record a reply: stops pending follow-up reminders. */
export async function recordReply(businessId: string, notes: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("outreach_events").insert({
    business_id: businessId,
    event_type: "reply",
    notes: notes || null,
  });
  await supabase
    .from("follow_up_tasks")
    .update({ status: "cancelled" })
    .eq("business_id", businessId)
    .eq("status", "pending");
  const { error } = await supabase
    .from("businesses")
    .update({ status: "replied", last_action_at: new Date().toISOString() })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  revalidateOutreach(businessId);
}

/** Permanent opt-out: suppression-list entry + do_not_contact + cancel reminders. */
export async function recordOptOut(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { data: business, error: loadError } = await supabase
    .from("businesses")
    .select("id, name, domain, email, phone")
    .eq("id", businessId)
    .single();
  if (loadError || !business) throw new Error(loadError?.message ?? "Business not found");

  await supabase.from("outreach_events").insert({
    business_id: businessId,
    event_type: "opt_out",
  });
  const { error: suppressError } = await supabase.from("suppression_list").insert({
    domain: business.domain,
    email: business.email,
    phone: business.phone,
    company_name: business.name,
    reason: "opt_out",
  });
  // Unique index violation just means they're already suppressed.
  if (suppressError && !suppressError.message.includes("duplicate")) {
    throw new Error(suppressError.message);
  }
  await supabase
    .from("follow_up_tasks")
    .update({ status: "cancelled" })
    .eq("business_id", businessId)
    .eq("status", "pending");
  const { error } = await supabase
    .from("businesses")
    .update({ status: "do_not_contact", last_action_at: new Date().toISOString() })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  revalidateOutreach(businessId);
}

export async function completeFollowUp(followUpId: string, businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("follow_up_tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", followUpId);
  if (error) throw new Error(error.message);
  revalidateOutreach(businessId);
}

export async function discardDraft(draftId: string, businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_drafts")
    .update({ status: "discarded" })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
  revalidateOutreach(businessId);
}
