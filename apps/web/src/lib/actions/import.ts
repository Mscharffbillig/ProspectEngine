"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { campaigns, importJobs, researchTasks } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";
import { csvRowSchema, type CsvRow } from "@/lib/schemas";

export interface ImportCommitResult {
  error?: string;
  jobId?: string;
  accepted?: number;
  rejected?: { row: number; error: string }[];
}

export async function listCampaignOptions(): Promise<{ id: string; name: string }[]> {
  await requireUser();
  return db().select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
}

/**
 * Validates previewed rows and stores them on an import job; the Python worker
 * performs normalization/dedup so that logic lives in exactly one place.
 */
export async function commitImport(
  filename: string,
  campaignId: string | null,
  records: Record<string, string>[],
): Promise<ImportCommitResult> {
  await requireUser();
  if (records.length === 0) return { error: "No rows to import" };
  if (records.length > 5000) return { error: "Import limited to 5000 rows" };

  const accepted: CsvRow[] = [];
  const rejected: { row: number; error: string }[] = [];
  records.forEach((record, i) => {
    const parsed = csvRowSchema.safeParse(record);
    if (parsed.success) accepted.push(parsed.data);
    else rejected.push({ row: i + 2, error: parsed.error.errors.map((e) => e.message).join("; ") });
  });
  if (accepted.length === 0) return { error: "No valid rows", rejected };

  try {
    const [job] = await db()
      .insert(importJobs)
      .values({
        campaignId,
        filename,
        rowCount: accepted.length,
        rows: accepted,
        errors: rejected,
      })
      .returning({ id: importJobs.id });
    if (!job) return { error: "Could not create import job" };

    await db().insert(researchTasks).values({
      taskType: "process_csv_import",
      campaignId,
      payload: { import_job_id: job.id },
    });
    revalidatePath("/import");
    return { jobId: job.id, accepted: accepted.length, rejected };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed" };
  }
}
