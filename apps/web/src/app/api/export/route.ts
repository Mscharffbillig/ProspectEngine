import { sql } from "drizzle-orm";
import { db } from "@/db";
import { businesses } from "@/db/schema";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const HEADERS = [
  "name",
  "domain",
  "website_url",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "industry",
  "status",
  "validation_status",
  "validation_overridden",
  "score",
  "name_confidence",
  "decision_maker",
  "decision_maker_role",
  "decision_maker_email",
  "best_contact",
  "campaign",
  "summary",
  "notes",
  "researched_at",
  "created_at",
] as const;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  // Quote when the value contains a delimiter, quote, or newline; escape quotes.
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** GET /api/export — download every lead and its key research fields as CSV. */
export async function GET(): Promise<Response> {
  await requireUser();

  const rows = await db().query.businesses.findMany({
    with: {
      contacts: true,
      campaign: { columns: { name: true } },
    },
    orderBy: [sql`${businesses.score} desc nulls last`],
  });

  const lines = [HEADERS.join(",")];
  for (const b of rows) {
    const dm = b.contacts.find((c) => c.isDecisionMaker && c.name) ?? null;
    const bestContact = dm?.email ?? b.email ?? dm?.phone ?? b.phone ?? "";
    lines.push(
      [
        b.name,
        b.domain,
        b.websiteUrl,
        b.phone,
        b.email,
        b.address,
        b.city,
        b.state,
        b.industry,
        b.status,
        b.validationStatus,
        b.validationOverridden,
        b.score,
        b.nameConfidence,
        dm?.name,
        dm?.role,
        dm?.email,
        bestContact,
        b.campaign?.name,
        b.summary,
        b.notes,
        b.researchedAt,
        b.createdAt,
      ]
        .map(cell)
        .join(","),
    );
  }

  // Leading BOM so Excel opens the UTF-8 file with the right encoding.
  const csv = "﻿" + lines.join("\r\n") + "\r\n";
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospectengine-leads-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
