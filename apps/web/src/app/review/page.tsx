import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LeadActions } from "@/components/lead-actions";
import { ScoreBadge, StatusBadge } from "@/components/badges";
import type {
  Business,
  BusinessContact,
  PainHypothesis,
  QualificationEvidence,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type ReviewLead = Business & {
  business_contacts: BusinessContact[];
  pain_hypotheses: PainHypothesis[];
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; campaign?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const statusFilter =
    params.status === "all" ? ["qualified", "needs_review", "approved", "snoozed"] :
    params.status ? [params.status] : ["qualified", "needs_review"];

  let query = supabase
    .from("businesses")
    .select("*, business_contacts(*), pain_hypotheses(*)")
    .in("status", statusFilter)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(50);
  if (params.campaign) query = query.eq("campaign_id", params.campaign);
  const { data: leads, error } = await query;

  // Latest qualification evidence per business, for signal chips.
  const leadIds = (leads ?? []).map((l) => l.id);
  const { data: runs } = leadIds.length
    ? await supabase
        .from("qualification_runs")
        .select("business_id, created_at, qualification_evidence(*)")
        .in("business_id", leadIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const evidenceByBusiness = new Map<string, QualificationEvidence[]>();
  for (const run of runs ?? []) {
    if (!evidenceByBusiness.has(run.business_id)) {
      evidenceByBusiness.set(run.business_id, run.qualification_evidence ?? []);
    }
  }

  const { data: campaigns } = await supabase.from("campaigns").select("id, name");

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
                  : "bg-white text-gray-600 border border-gray-200"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          Failed to load leads: {error.message}
        </p>
      )}
      {leads && leads.length === 0 && (
        <p className="text-sm text-gray-500">
          Nothing to review. Run a campaign from the Campaigns page and make sure the worker is
          running.
        </p>
      )}

      <div className="space-y-4">
        {((leads ?? []) as ReviewLead[]).map((lead) => {
          const decisionMaker =
            lead.business_contacts.find((c) => c.is_decision_maker && c.name) ??
            lead.business_contacts.find((c) => c.name);
          const contactMethod = decisionMaker?.email ?? lead.email ?? lead.phone ?? "contact form";
          const evidence = evidenceByBusiness.get(lead.id) ?? [];
          const campaignName = campaigns?.find((c) => c.id === lead.campaign_id)?.name;
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
                  </div>
                  <div className="mt-0.5 text-sm text-gray-500">
                    {[lead.industry, [lead.city, lead.state].filter(Boolean).join(", "), campaignName]
                      .filter(Boolean)
                      .join(" · ")}
                    {lead.website_url && (
                      <>
                        {" · "}
                        <a
                          href={lead.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
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
                  <div className="text-gray-500">
                    Likely decision-maker:{" "}
                    <span className="text-gray-900">
                      {decisionMaker?.name
                        ? `${decisionMaker.name}${decisionMaker.role ? ` (${decisionMaker.role})` : ""}`
                        : "not identified"}
                    </span>
                  </div>
                  <div className="text-gray-500">
                    Best contact: <span className="text-gray-900">{contactMethod}</span>
                  </div>
                  {lead.researched_at && (
                    <div className="text-gray-500">
                      Researched: {new Date(lead.researched_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap content-start gap-1">
                  {evidence.map((e) => (
                    <span
                      key={e.id}
                      title={e.evidence ?? undefined}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        e.points >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                      }`}
                    >
                      {e.points >= 0 ? "+" : ""}
                      {e.points} {e.label}
                    </span>
                  ))}
                </div>
              </div>

              {lead.pain_hypotheses.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {lead.pain_hypotheses.slice(0, 3).map((h) => (
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
