import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
// Sorted "score desc nulls last" — drizzle's desc() would misplace the
// NULLS clause, so the fragment is written out.
import Link from "next/link";
import { db } from "@/db";
import { businesses, qualificationRuns } from "@/db/schema";
import { LeadActions } from "@/components/lead-actions";
import { ScoreBadge, StatusBadge } from "@/components/badges";
import { EvidenceChip } from "@/components/evidence-chip";
import { ValidationBadge, ValidationPanel } from "@/components/validation-panel";
import type { QualificationEvidence } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; campaign?: string }>;
}) {
  const params = await searchParams;

  const statusFilter =
    params.status === "all"
      ? ["qualified", "needs_review", "approved", "snoozed"]
      : params.status
        ? [params.status]
        : ["qualified", "needs_review"];

  const filters: SQL[] = [inArray(businesses.status, statusFilter)];
  if (params.campaign) filters.push(eq(businesses.campaignId, params.campaign));

  const leads = await db().query.businesses.findMany({
    where: and(...filters),
    with: {
      contacts: true,
      hypotheses: true,
      campaign: { columns: { name: true } },
    },
    orderBy: [sql`${businesses.score} desc nulls last`],
    limit: 50,
  });

  // Latest qualification evidence per business, for signal chips.
  const leadIds = leads.map((l) => l.id);
  const runs = leadIds.length
    ? await db().query.qualificationRuns.findMany({
        where: inArray(qualificationRuns.businessId, leadIds),
        with: { evidence: true },
        orderBy: desc(qualificationRuns.createdAt),
      })
    : [];
  const evidenceByBusiness = new Map<string, QualificationEvidence[]>();
  for (const run of runs) {
    if (!evidenceByBusiness.has(run.businessId)) {
      evidenceByBusiness.set(run.businessId, run.evidence);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Daily review</h1>
        <nav aria-label="Status filter" className="flex gap-2 text-sm">
          {[
            ["", "To review"],
            ["qualified", "Qualified"],
            ["needs_review", "Needs review"],
            ["approved", "Approved"],
            ["all", "All open"],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={value ? `/review?status=${value}` : "/review"}
              className={`rounded-full px-3 py-1 ${
                (params.status ?? "") === value
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {leads.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing to review. Run a campaign from the Campaigns page and make sure the worker is
          running.
        </p>
      )}

      <div className="space-y-4">
        {leads.map((lead) => {
          // Only validated (high/confirmed) people are shown as decision-makers.
          const decisionMaker = lead.contacts.find((c) => c.isDecisionMaker && c.name);
          const unverified = lead.contacts.find((c) => !c.isDecisionMaker && c.name);
          const contactMethod = decisionMaker?.email ?? lead.email ?? lead.phone ?? "contact form";
          const evidence = evidenceByBusiness.get(lead.id) ?? [];
          return (
            <article key={lead.id} className="card space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/businesses/${lead.id}`}
                      className="text-lg font-semibold hover:underline"
                    >
                      {lead.name}
                    </Link>
                    <ScoreBadge score={lead.score} />
                    <StatusBadge status={lead.status} />
                    {lead.validationStatus !== "valid" && (
                      <ValidationBadge status={lead.validationStatus} />
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {[
                      lead.industry,
                      [lead.city, lead.state].filter(Boolean).join(", "),
                      lead.campaign?.name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {lead.websiteUrl && (
                      <>
                        {" · "}
                        <a
                          href={lead.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {lead.domain ?? "website"}
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <LeadActions businessId={lead.id} />
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">
                    Likely decision-maker:{" "}
                    <span className="text-gray-900 dark:text-gray-100">
                      {decisionMaker?.name
                        ? `${decisionMaker.name}${decisionMaker.role ? ` (${decisionMaker.role})` : ""}`
                        : "not identified"}
                    </span>
                    {!decisionMaker && unverified?.name && (
                      <span className="ml-1 text-xs text-yellow-700 dark:text-yellow-400">
                        (unverified: {unverified.name})
                      </span>
                    )}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">
                    Best contact: <span className="text-gray-900 dark:text-gray-100">{contactMethod}</span>
                  </div>
                  {lead.researchedAt && (
                    <div className="text-gray-500 dark:text-gray-400">
                      Researched: {lead.researchedAt.toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap content-start gap-1">
                  {evidence.map((e) => (
                    <EvidenceChip key={e.id} evidence={e} />
                  ))}
                </div>
              </div>

              {lead.validationStatus !== "valid" && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-500 dark:text-gray-400">
                    Validation details
                  </summary>
                  <div className="mt-1">
                    <ValidationPanel business={lead} />
                  </div>
                </details>
              )}

              {lead.hypotheses.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
                  {lead.hypotheses.slice(0, 3).map((h) => (
                    <li key={h.id}>{h.question}</li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
