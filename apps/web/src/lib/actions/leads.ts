"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { businesses, followUpTasks, researchTasks, validationOverrides } from "@/db/schema";
import { currentUser, requireUser } from "@/lib/auth/server";

function revalidateLeadPages(businessId: string) {
  revalidatePath("/review");
  revalidatePath("/outreach");
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
}

export async function approveLead(businessId: string): Promise<void> {
  await requireUser();
  // Standard approval is only for validation-passing leads; anything else
  // must go through overrideValidation (audited).
  const business = await db().query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { validationStatus: true, validationOverridden: true },
  });
  if (!business) throw new Error("Business not found");
  if (business.validationStatus !== "valid" && !business.validationOverridden) {
    throw new Error(
      `Validation is ${business.validationStatus.replaceAll("_", " ")} — use “Override validation” with a reason instead.`,
    );
  }
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

/**
 * Audited manual override of a failed/ambiguous validation. Preserves the
 * automated result; records who, when, why, and which gates had failed.
 */
export async function overrideValidation(businessId: string, reason: string): Promise<void> {
  await requireUser();
  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    throw new Error("An override reason is required (at least 5 characters).");
  }
  const business = await db().query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { validationStatus: true, validationReasons: true },
  });
  if (!business) throw new Error("Business not found");
  if (business.validationStatus === "valid") {
    throw new Error("Validation already passes — use the normal Approve action.");
  }
  const user = await currentUser();
  await db().insert(validationOverrides).values({
    businessId,
    previousStatus: business.validationStatus,
    failedGates: business.validationReasons ?? [],
    reason: trimmed,
    overriddenBy: user?.email ?? "local-operator",
  });
  await db()
    .update(businesses)
    .set({ validationOverridden: true, lastActionAt: new Date() })
    .where(eq(businesses.id, businessId));
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
