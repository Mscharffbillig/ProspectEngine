"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  businesses,
  followUpTasks,
  outreachDrafts,
  outreachEvents,
  suppressionList,
} from "@/db/schema";

const FIRST_FOLLOW_UP_DAYS = 4;
const FINAL_FOLLOW_UP_DAYS = 10;

function revalidateOutreach(businessId: string) {
  revalidatePath("/outreach");
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
}

async function cancelPendingFollowUps(businessId: string): Promise<void> {
  await db()
    .update(followUpTasks)
    .set({ status: "cancelled" })
    .where(and(eq(followUpTasks.businessId, businessId), eq(followUpTasks.status, "pending")));
}

/** Mark a draft as manually sent; schedules the 4-day and 10-day follow-ups. */
export async function markDraftSent(
  draftId: string,
  businessId: string,
  channel: string,
): Promise<void> {
  const now = new Date();
  await db()
    .update(outreachDrafts)
    .set({ status: "sent", sentAt: now, channel })
    .where(eq(outreachDrafts.id, draftId));
  await db().insert(outreachEvents).values({
    businessId,
    draftId,
    eventType: "sent",
    channel,
  });
  await db()
    .update(businesses)
    .set({ status: "contacted", lastActionAt: now })
    .where(eq(businesses.id, businessId));

  const due = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  await db()
    .insert(followUpTasks)
    .values([
      { businessId, draftId, kind: "first_follow_up", dueDate: due(FIRST_FOLLOW_UP_DAYS) },
      { businessId, draftId, kind: "final_follow_up", dueDate: due(FINAL_FOLLOW_UP_DAYS) },
    ]);
  revalidateOutreach(businessId);
}

/** Record a reply: stops pending follow-up reminders. */
export async function recordReply(businessId: string, notes: string): Promise<void> {
  await db().insert(outreachEvents).values({
    businessId,
    eventType: "reply",
    notes: notes || null,
  });
  await cancelPendingFollowUps(businessId);
  await db()
    .update(businesses)
    .set({ status: "replied", lastActionAt: new Date() })
    .where(eq(businesses.id, businessId));
  revalidateOutreach(businessId);
}

/** Permanent opt-out: suppression-list entry + do_not_contact + cancel reminders. */
export async function recordOptOut(businessId: string): Promise<void> {
  const business = await db().query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { id: true, name: true, domain: true, email: true, phone: true },
  });
  if (!business) throw new Error("Business not found");

  await db().insert(outreachEvents).values({ businessId, eventType: "opt_out" });
  try {
    await db().insert(suppressionList).values({
      domain: business.domain,
      email: business.email,
      phone: business.phone,
      companyName: business.name,
      reason: "opt_out",
    });
  } catch (e) {
    // Unique index violation just means they're already suppressed.
    if (!(e instanceof Error && /duplicate|unique/i.test(e.message))) throw e;
  }
  await cancelPendingFollowUps(businessId);
  await db()
    .update(businesses)
    .set({ status: "do_not_contact", lastActionAt: new Date() })
    .where(eq(businesses.id, businessId));
  revalidateOutreach(businessId);
}

export async function completeFollowUp(followUpId: string, businessId: string): Promise<void> {
  await db()
    .update(followUpTasks)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(followUpTasks.id, followUpId));
  revalidateOutreach(businessId);
}

export async function discardDraft(draftId: string, businessId: string): Promise<void> {
  await db()
    .update(outreachDrafts)
    .set({ status: "discarded" })
    .where(eq(outreachDrafts.id, draftId));
  revalidateOutreach(businessId);
}
