"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { csvRowSchema, type CsvRow } from "@/lib/schemas";

export interface ImportCommitResult {
  error?: string;
  jobId?: string;
  accepted?: number;
  rejected?: { row: number; error: string }[];
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

  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("import_jobs")
    .insert({
      campaign_id: campaignId,
      filename,
      row_count: accepted.length,
      rows: accepted,
      errors: rejected,
    })
    .select("id")
    .single();
  if (error || !job) return { error: error?.message ?? "Could not create import job" };

  const { error: taskError } = await supabase.from("research_tasks").insert({
    task_type: "process_csv_import",
    campaign_id: campaignId,
    payload: { import_job_id: job.id },
  });
  if (taskError) return { error: taskError.message };

  revalidatePath("/import");
  return { jobId: job.id, accepted: accepted.length, rejected };
}
