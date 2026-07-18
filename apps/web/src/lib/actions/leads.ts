"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { businesses, followUpTasks, researchTasks } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";

function revalidateLeadPages(businessId: string) {
  revalidatePath("/review");
  revalidatePath("/outreach");
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
}

export async function approveLead(businessId: string): Promise<void> {
  await requireUser();
  await db()
    .update(businesses)
    .set({ status: "approved", lastActionAt: new Date() })
    .where(eq(businesses.id, businessId));
  // Approval immediately queues an outreach draft so the lead is actionable.
  await db().insert(researchTasks).values({
    taskType: "generate_outreach_draft",
    businessId,
  });
  revalidateLeadPages(businessId);
}

export async function rejectLead(businessId: string, reason: string): Promise<void> {
  await requireUser();
  await db()
    .update(businesses)
    .set({ status: "rejected", rejectionReason: reason, lastActionAt: new Date() })
    .where(eq(businesses.id, businessId));
  await cancelFollowUps(businessId);
  revalidateLeadPages(businessId);
}

export async function snoozeLead(businessId: string, days: number): Promise<void> {
  await requireUser();
  const until = new Date();
  until.setDate(until.getDate() + days);
  await db()
    .update(businesses)
    .set({
      status: "snoozed",
      snoozedUntil: until,
      nextActionAt: until,
      lastActionAt: new Date(),
    })
    .where(eq(businesses.id, businessId));
  revalidateLeadPages(businessId);
}

export async function setLeadStatus(businessId: string, status: string): Promise<void> {
  await requireUser();
  await db()
    .update(businesses)
    .set({ status, lastActionAt: new Date() })
    .where(eq(businesses.id, businessId));
  if (["lost", "do_not_contact"].includes(status)) {
    await cancelFollowUps(businessId);
  }
  revalidateLeadPages(businessId);
}

export async function saveLeadNotes(businessId: string, formData: FormData): Promise<void> {
  await requireUser();
  const notes = formData.get("notes");
  await db()
    .update(businesses)
    .set({ notes: typeof notes === "string" ? notes : null })
    .where(eq(businesses.id, businessId));
  revalidateLeadPages(businessId);
}

export async function requestDraft(businessId: string): Promise<void> {
  await requireUser();
  await db().insert(researchTasks).values({
    taskType: "generate_outreach_draft",
    businessId,
  });
  revalidateLeadPages(businessId);
}

export async function requestResearch(businessId: string): Promise<void> {
  await requireUser();
  await db().insert(researchTasks).values({
    taskType: "research_website",
    businessId,
  });
  revalidateLeadPages(businessId);
}

async function cancelFollowUps(businessId: string): Promise<void> {
  await db()
    .update(followUpTasks)
    .set({ status: "cancelled" })
    .where(and(eq(followUpTasks.businessId, businessId), eq(followUpTasks.status, "pending")));
}
