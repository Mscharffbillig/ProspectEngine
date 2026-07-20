"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { businessContacts, businesses, researchTasks } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";
import { normalizeCompanyName } from "@/lib/normalize";

// Role types accepted by the business_contacts.role_type CHECK constraint.
export const CONTACT_ROLE_TYPES = [
  "owner",
  "founder",
  "general_manager",
  "operations_manager",
  "office_manager",
  "service_manager",
  "project_manager",
  "other",
  "unknown",
] as const;

function revalidate(businessId: string) {
  revalidatePath("/review");
  revalidatePath("/outreach");
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
}

/**
 * Re-run validation + scoring in the worker so a correction (e.g. a newly added
 * decision-maker, or a fixed name that clears an identity conflict) is reflected
 * in the lead's status. All qualification logic stays in the worker — the web
 * app only enqueues the task.
 */
async function enqueueRescore(businessId: string, campaignId: string | null) {
  await db()
    .insert(researchTasks)
    .values({ taskType: "score_business", businessId, campaignId });
}

export interface ProfileInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  industry: string;
  summary: string;
}

/** Operator corrections to the core business fields, from their own research. */
export async function updateBusinessProfile(
  businessId: string,
  input: ProfileInput,
): Promise<void> {
  await requireUser();
  const existing = await db().query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { name: true, campaignId: true },
  });
  if (!existing) throw new Error("Business not found");

  const name = input.name.trim();
  if (!name) throw new Error("Business name cannot be empty.");

  const update: Record<string, unknown> = {
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
    address: input.address.trim() || null,
    city: input.city.trim() || null,
    state: input.state.trim() || null,
    industry: input.industry.trim() || null,
    summary: input.summary.trim() || null,
    lastActionAt: new Date(),
  };
  if (name !== existing.name) {
    // An operator-set name is authoritative: mark it manual so reprocessing
    // never overwrites it, and refresh the dedup key.
    update.name = name;
    update.normalizedName = normalizeCompanyName(name);
    update.nameConfidence = "manual";
    update.nameSource = "manual";
  }

  await db().update(businesses).set(update).where(eq(businesses.id, businessId));
  await enqueueRescore(businessId, existing.campaignId);
  revalidate(businessId);
}

export interface ContactInput {
  id?: string;
  name: string;
  role: string;
  roleType: string;
  email: string;
  phone: string;
  isDecisionMaker: boolean;
}

/**
 * Add or update a contact the operator confirmed by visiting the site. Stored as
 * method='manual' with confirmed confidence, so reprocessing keeps it (only
 * method='auto' contacts are replaced).
 */
export async function saveContact(businessId: string, input: ContactInput): Promise<void> {
  await requireUser();
  const business = await db().query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { campaignId: true },
  });
  if (!business) throw new Error("Business not found");

  const name = input.name.trim();
  if (!name) throw new Error("Contact name is required.");
  const roleType = (CONTACT_ROLE_TYPES as readonly string[]).includes(input.roleType)
    ? input.roleType
    : "unknown";
  const email = input.email.trim() || null;

  const values = {
    name,
    role: input.role.trim() || null,
    roleType,
    email,
    phone: input.phone.trim() || null,
    isDecisionMaker: input.isDecisionMaker,
    method: "manual",
    nameConfidence: "confirmed",
    emailSource: email ? "operator_verified" : null,
    emailConfidence: email ? "confirmed" : null,
    updatedAt: new Date(),
  };

  if (input.id) {
    await db()
      .update(businessContacts)
      .set(values)
      .where(and(eq(businessContacts.id, input.id), eq(businessContacts.businessId, businessId)));
  } else {
    await db().insert(businessContacts).values({ businessId, ...values });
  }
  await enqueueRescore(businessId, business.campaignId);
  revalidate(businessId);
}

export async function deleteContact(businessId: string, contactId: string): Promise<void> {
  await requireUser();
  await db()
    .delete(businessContacts)
    .where(and(eq(businessContacts.id, contactId), eq(businessContacts.businessId, businessId)));
  const business = await db().query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { campaignId: true },
  });
  await enqueueRescore(businessId, business?.campaignId ?? null);
  revalidate(businessId);
}
