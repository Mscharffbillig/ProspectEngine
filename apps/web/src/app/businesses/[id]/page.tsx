import { asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { businesses, extractedFacts, outreachDrafts, qualificationRuns } from "@/db/schema";
import { ConfidenceBadge, ScoreBadge, StatusBadge } from "@/components/badges";
import { LeadActions } from "@/components/lead-actions";
import { ValidationPanel } from "@/components/validation-panel";
import { requestDraft, requestResearch, saveLeadNotes } from "@/lib/actions/leads";

export const dynamic = "force-dynamic";

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const lead = await db().query.businesses.findFirst({
    where: eq(businesses.id, id),
    with: {
      contacts: true,
      facts: { orderBy: asc(extractedFacts.factKey) },
      pages: {
        columns: {
          id: true,
          url: true,
          title: true,
          httpStatus: true,
          fetchedAt: true,
          crawlAllowed: true,
        },
      },
      qualificationRuns: {
        orderBy: desc(qualificationRuns.createdAt),
        limit: 1,
        with: { evidence: true },
      },
      hypotheses: true,
      drafts: { orderBy: desc(outreachDrafts.createdAt) },
      sources: { columns: { id: true, sourceType: true, query: true, url: true, title: true } },
    },
  });
  if (!lead) notFound();

  const latestRun = lead.qualificationRuns[0] ?? null;
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
          {lead.websiteUrl && (
            <p>
              Website:{" "}
              <a
                href={lead.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {lead.websiteUrl}
              </a>
            </p>
          )}
          {lead.phone && <p>Phone: {lead.phone}</p>}
          {lead.email && <p>Email: {lead.email}</p>}
          {lead.address && <p>Address: {lead.address}</p>}
          <p>Location: {[lead.city, lead.state].filter(Boolean).join(", ") || "unknown"}</p>
          {lead.industry && <p>Industry: {lead.industry}</p>}
          {lead.rejectionReason && <p>Rejection reason: {lead.rejectionReason}</p>}
          {lead.nextActionAt && <p>Next action: {lead.nextActionAt.toLocaleDateString()}</p>}
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
          {lead.contacts.length === 0 && <p className="text-gray-500 dark:text-gray-400">No contacts extracted.</p>}
          <ul className="space-y-2">
            {lead.contacts.map((c) => (
              <li key={c.id} className="border-b border-gray-100 dark:border-gray-800 pb-2 last:border-0">
                <div className="font-medium">
                  {c.name ?? "(unnamed contact)"}
                  {c.role && <span className="font-normal text-gray-500 dark:text-gray-400"> — {c.role}</span>}
                  {c.isDecisionMaker && (
                    <span className="ml-1 rounded bg-blue-50 px-1.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      decision-maker
                    </span>
                  )}
                  {c.name && !c.isDecisionMaker && c.method === "auto" && (
                    <span className="ml-1 rounded bg-yellow-50 px-1.5 text-xs text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400">
                      unverified{c.nameConfidence ? ` (${c.nameConfidence})` : ""}
                    </span>
                  )}
                </div>
                {c.email && (
                  <div className="text-gray-600 dark:text-gray-400">
                    {c.email}{" "}
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      ({c.emailSource?.replaceAll("_", " ")}, {c.emailConfidence})
                    </span>
                  </div>
                )}
                {c.excerpt && <div className="text-xs text-gray-400 dark:text-gray-500">“{c.excerpt}”</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Validation</h2>
        <ValidationPanel business={lead} />
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">
          Qualification{" "}
          {latestRun &&
            `— score ${latestRun.totalScore} (v${latestRun.scoringVersion}, ${latestRun.createdAt.toLocaleDateString()})`}
        </h2>
        {!latestRun && <p className="text-gray-500 dark:text-gray-400">Not scored yet.</p>}
        {latestRun && (
          <ul className="space-y-1">
            {latestRun.evidence.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span
                  className={`w-10 shrink-0 text-right font-mono ${
                    e.points >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
                  }`}
                >
                  {e.points >= 0 ? "+" : ""}
                  {e.points}
                </span>
                <span>
                  {e.label}
                  {e.confidence && (
                    <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                      [{e.confidence}]
                    </span>
                  )}
                  {e.evidence && <span className="text-gray-500 dark:text-gray-400"> — “{e.evidence}”</span>}{" "}
                  {e.sourceUrl && (
                    <a
                      href={e.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
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

      {lead.hypotheses.length > 0 && (
        <section className="card text-sm">
          <h2 className="mb-2 font-medium">Pain hypotheses (questions, not claims)</h2>
          <ul className="list-disc space-y-1 pl-5">
            {lead.hypotheses.map((h) => (
              <li key={h.id}>
                {h.question}
                {h.evidence && <span className="text-gray-500 dark:text-gray-400"> (evidence: “{h.evidence}”)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Extracted facts ({lead.facts.length})</h2>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400">
                <th className="py-1 pr-3 font-normal">Fact</th>
                <th className="py-1 pr-3 font-normal">Value</th>
                <th className="py-1 pr-3 font-normal">Confidence</th>
                <th className="py-1 font-normal">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {lead.facts.map((f) => (
                <tr key={f.id} className="border-t border-gray-100 dark:border-gray-800 align-top">
                  <td className="py-1.5 pr-3 font-mono text-xs">{f.factKey}</td>
                  <td className="py-1.5 pr-3">{f.value}</td>
                  <td className="py-1.5 pr-3">
                    <ConfidenceBadge confidence={f.confidence} />
                  </td>
                  <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {f.excerpt && <span>“{f.excerpt}” </span>}
                    {f.sourceUrl && (
                      <a
                        href={f.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
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
            {lead.pages.map((p) => (
              <li key={p.id}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {p.title ?? p.url}
                </a>{" "}
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  ({p.httpStatus}, {p.fetchedAt.toLocaleDateString()}
                  {p.crawlAllowed ? "" : ", robots disallowed"})
                </span>
              </li>
            ))}
            {lead.pages.length === 0 && <li className="text-gray-500 dark:text-gray-400">No pages stored.</li>}
          </ul>
          <h2 className="mb-2 mt-4 font-medium">Discovery sources</h2>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
            {lead.sources.map((s) => (
              <li key={s.id}>
                [{s.sourceType}] {s.query && <span>query: “{s.query}” </span>}
                {s.title}
              </li>
            ))}
          </ul>
        </section>

        <section className="card text-sm">
          <h2 className="mb-2 font-medium">Outreach history</h2>
          {lead.drafts.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">No drafts yet. Use “Generate outreach draft”.</p>
          )}
          <ul className="space-y-2">
            {lead.drafts.map((d) => (
              <li key={d.id} className="rounded border border-gray-100 dark:border-gray-800 p-2">
                <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                  {d.status} · {d.method} · {d.createdAt.toLocaleString()}
                  {d.sentAt && ` · sent ${d.sentAt.toLocaleDateString()} via ${d.channel}`}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 dark:text-gray-300">{d.body}</pre>
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
