"use server";

import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { businesses, researchTasks, suppressionList } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";
import { isEnrichable } from "@/lib/types";

/**
 * Queue an on-demand enrichment for one shortlisted lead. Guards eligibility
 * (status/validation + suppression) here so ineligible leads never queue a task;
 * the worker re-checks defensively. Never runs automatically.
 */
export async function enrichLead(businessId: string, force = false): Promise<void> {
  await requireUser();
  const business = await db().query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: {
      status: true,
      validationStatus: true,
      validationOverridden: true,
      domain: true,
      email: true,
      phone: true,
    },
  });
  if (!business) throw new Error("Business not found");

  if (!isEnrichable(business.status, business.validationStatus, business.validationOverridden)) {
    throw new Error(
      "This lead is not eligible for enrichment (only valid, qualified, needs-review, or overridden leads).",
    );
  }

  const suppressed = await db()
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(
      or(
        business.domain
          ? and(isNotNull(suppressionList.domain), sql`lower(${suppressionList.domain}) = lower(${business.domain})`)
          : sql`false`,
        business.email
          ? and(isNotNull(suppressionList.email), sql`lower(${suppressionList.email}) = lower(${business.email})`)
          : sql`false`,
        business.phone
          ? and(isNotNull(suppressionList.phone), eq(suppressionList.phone, business.phone))
          : sql`false`,
      ),
    )
    .limit(1);
  if (suppressed.length > 0) {
    throw new Error("This business is on the suppression list and cannot be enriched.");
  }

  // maxAttempts=1: a failed enrichment must not silently re-run paid providers.
  await db().insert(researchTasks).values({
    taskType: "enrich_lead",
    businessId,
    payload: { force },
    maxAttempts: 1,
  });
  revalidatePath(`/businesses/${businessId}`);
}
