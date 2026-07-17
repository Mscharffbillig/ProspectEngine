import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConfidenceBadge, ScoreBadge, StatusBadge } from "@/components/badges";
import { LeadActions } from "@/components/lead-actions";
import { requestDraft, requestResearch, saveLeadNotes } from "@/lib/actions/leads";
import type {
  Business,
  BusinessContact,
  ExtractedFact,
  OutreachDraft,
  PainHypothesis,
  QualificationRun,
  WebsitePage,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: business } = await supabase.from("businesses").select("*").eq("id", id).single();
  if (!business) notFound();
  const lead = business as Business;

  const [
    { data: contacts },
    { data: facts },
    { data: pages },
    { data: runs },
    { data: hypotheses },
    { data: drafts },
    { data: sources },
  ] = await Promise.all([
    supabase.from("business_contacts").select("*").eq("business_id", id),
    supabase.from("extracted_facts").select("*").eq("business_id", id).order("fact_key"),
    supabase.from("website_pages").select("id, url, title, http_status, fetched_at, crawl_allowed").eq("business_id", id),
    supabase
      .from("qualification_runs")
      .select("*, qualification_evidence(*)")
      .eq("business_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("pain_hypotheses").select("*").eq("business_id", id),
    supabase
      .from("outreach_drafts")
      .select("*")
      .eq("business_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("business_sources").select("source_type, query, url, title").eq("business_id", id),
  ]);

  const latestRun = (runs?.[0] as QualificationRun | undefined) ?? null;
  const draftAction = requestDraft.bind(null, id);
  const researchAction = requestResearch.bind(null, id);
  const notesAction = saveLeadNotes.bind(null, id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{lead.name}</h1>
        <ScoreBadge score={lead.score} />
        <StatusBadge status={lead.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-1 text-sm">
          <h2 className="mb-1 font-medium">Profile</h2>
          {lead.website_url && (
            <p>
              Website:{" "}
              <a
                href={lead.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {lead.website_url}
              </a>
            </p>
          )}
          {lead.phone && <p>Phone: {lead.phone}</p>}
          {lead.email && <p>Email: {lead.email}</p>}
          {lead.address && <p>Address: {lead.address}</p>}
          <p>Location: {[lead.city, lead.state].filter(Boolean).join(", ") || "unknown"}</p>
          {lead.industry && <p>Industry: {lead.industry}</p>}
          {lead.rejection_reason && <p>Rejection reason: {lead.rejection_reason}</p>}
          {lead.next_action_at && (
            <p>Next action: {new Date(lead.next_action_at).toLocaleDateString()}</p>
          )}
          <div className="pt-2">
            <LeadActions businessId={id} />
          </div>
          <div className="flex gap-2 pt-2">
            <form action={draftAction}>
              <button type="submit" className="btn-secondary">
                Generate outreach draft
              </button>
            </form>
            <form action={researchAction}>
              <button type="submit" className="btn-secondary">
                Re-research website
              </button>
            </form>
          </div>
        </section>

        <section className="card text-sm">
          <h2 className="mb-2 font-medium">Contacts</h2>
          {(contacts ?? []).length === 0 && <p className="text-gray-500">No contacts extracted.</p>}
          <ul className="space-y-2">
            {((contacts ?? []) as BusinessContact[]).map((c) => (
              <li key={c.id} className="border-b border-gray-100 pb-2 last:border-0">
                <div className="font-medium">
                  {c.name ?? "(unnamed contact)"}
                  {c.role && <span className="font-normal text-gray-500"> — {c.role}</span>}
                  {c.is_decision_maker && (
                    <span className="ml-1 rounded bg-blue-50 px-1.5 text-xs text-blue-700">
                      decision-maker
                    </span>
                  )}
                </div>
                {c.email && (
                  <div className="text-gray-600">
                    {c.email}{" "}
                    <span className="text-xs text-gray-400">
                      ({c.email_source?.replaceAll("_", " ")}, {c.email_confidence})
                    </span>
                  </div>
                )}
                {c.excerpt && <div className="text-xs text-gray-400">“{c.excerpt}”</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">
          Qualification {latestRun && `— score ${latestRun.total_score} (v${latestRun.scoring_version}, ${new Date(latestRun.created_at).toLocaleDateString()})`}
        </h2>
        {!latestRun && <p className="text-gray-500">Not scored yet.</p>}
        {latestRun && (
          <ul className="space-y-1">
            {latestRun.qualification_evidence.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span
                  className={`w-10 shrink-0 text-right font-mono ${
                    e.points >= 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {e.points >= 0 ? "+" : ""}
                  {e.points}
                </span>
                <span>
                  {e.label}
                  {e.evidence && <span className="text-gray-500"> — “{e.evidence}”</span>}{" "}
                  {e.source_url && (
                    <a
                      href={e.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      source
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(hypotheses ?? []).length > 0 && (
        <section className="card text-sm">
          <h2 className="mb-2 font-medium">Pain hypotheses (questions, not claims)</h2>
          <ul className="list-disc space-y-1 pl-5">
            {((hypotheses ?? []) as PainHypothesis[]).map((h) => (
              <li key={h.id}>
                {h.question}
                {h.evidence && (
                  <span className="text-gray-500"> (evidence: “{h.evidence}”)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Extracted facts ({facts?.length ?? 0})</h2>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-3 font-normal">Fact</th>
                <th className="py-1 pr-3 font-normal">Value</th>
                <th className="py-1 pr-3 font-normal">Confidence</th>
                <th className="py-1 font-normal">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {((facts ?? []) as ExtractedFact[]).map((f) => (
                <tr key={f.id} className="border-t border-gray-100 align-top">
                  <td className="py-1.5 pr-3 font-mono text-xs">{f.fact_key}</td>
                  <td className="py-1.5 pr-3">{f.value}</td>
                  <td className="py-1.5 pr-3">
                    <ConfidenceBadge confidence={f.confidence} />
                  </td>
                  <td className="py-1.5 text-xs text-gray-500">
                    {f.excerpt && <span>“{f.excerpt}” </span>}
                    {f.source_url && (
                      <a
                        href={f.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        source
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card text-sm">
          <h2 className="mb-2 font-medium">Website pages crawled</h2>
          <ul className="space-y-1">
            {((pages ?? []) as WebsitePage[]).map((p) => (
              <li key={p.id}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {p.title ?? p.url}
                </a>{" "}
                <span className="text-xs text-gray-400">
                  ({p.http_status}, {new Date(p.fetched_at).toLocaleDateString()}
                  {p.crawl_allowed ? "" : ", robots disallowed"})
                </span>
              </li>
            ))}
            {(pages ?? []).length === 0 && <li className="text-gray-500">No pages stored.</li>}
          </ul>
          <h2 className="mb-2 mt-4 font-medium">Discovery sources</h2>
          <ul className="space-y-1 text-xs text-gray-600">
            {(sources ?? []).map((s, i) => (
              <li key={i}>
                [{s.source_type}] {s.query && <span>query: “{s.query}” </span>}
                {s.title}
              </li>
            ))}
          </ul>
        </section>

        <section className="card text-sm">
          <h2 className="mb-2 font-medium">Outreach history</h2>
          {(drafts ?? []).length === 0 && (
            <p className="text-gray-500">No drafts yet. Use “Generate outreach draft”.</p>
          )}
          <ul className="space-y-2">
            {((drafts ?? []) as OutreachDraft[]).map((d) => (
              <li key={d.id} className="rounded border border-gray-100 p-2">
                <div className="mb-1 text-xs text-gray-500">
                  {d.status} · {d.method} · {new Date(d.created_at).toLocaleString()}
                  {d.sent_at && ` · sent ${new Date(d.sent_at).toLocaleDateString()} via ${d.channel}`}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700">{d.body}</pre>
              </li>
            ))}
          </ul>
          <h2 className="mb-2 mt-4 font-medium">Notes</h2>
          <form action={notesAction} className="space-y-2">
            <textarea name="notes" rows={4} className="field" defaultValue={lead.notes ?? ""} />
            <button type="submit" className="btn-secondary">
              Save notes
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
