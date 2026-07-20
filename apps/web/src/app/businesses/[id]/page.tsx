import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  businesses,
  enrichmentRuns,
  extractedFacts,
  outreachDrafts,
  qualificationRuns,
  researchTasks,
  validationOverrides,
} from "@/db/schema";
import { ConfidenceBadge, ScoreBadge, StatusBadge } from "@/components/badges";
import { EnrichmentSection } from "@/components/enrichment-section";
import { EvidenceChip } from "@/components/evidence-chip";
import { LeadActions } from "@/components/lead-actions";
import { LeadCorrections } from "@/components/lead-corrections";
import { ValidationBadge, ValidationPanel } from "@/components/validation-panel";
import { requestDraft, requestResearch, saveLeadNotes } from "@/lib/actions/leads";
import { isEnrichable } from "@/lib/types";

export const dynamic = "force-dynamic";

// Important pages first in the crawled-pages list.
const PAGE_PRIORITY = ["", "about", "team", "leadership", "staff", "services", "contact", "careers"];

function pagePriority(url: string): number {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (path === "/" || path === "") return 0;
  for (let i = 1; i < PAGE_PRIORITY.length; i++) {
    if (path.includes(PAGE_PRIORITY[i]!)) return i;
  }
  return PAGE_PRIORITY.length;
}

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const lead = await db().query.businesses.findFirst({
    where: eq(businesses.id, id),
    with: {
      contacts: true,
      facts: { orderBy: asc(extractedFacts.factKey) },
      pages: true,
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

  const overrides = await db().query.validationOverrides.findMany({
    where: eq(validationOverrides.businessId, id),
    orderBy: desc(validationOverrides.createdAt),
  });

  // Latest enrichment run with real results (a cache-hit "skipped" run points at
  // the prior completed one), plus any in-flight enrichment task.
  const enrichmentRun = await db().query.enrichmentRuns.findFirst({
    where: and(eq(enrichmentRuns.businessId, id), ne(enrichmentRuns.status, "skipped")),
    orderBy: desc(enrichmentRuns.createdAt),
    with: { evidence: true, contacts: true, usage: true },
  });
  const queuedEnrichment = await db().query.researchTasks.findFirst({
    where: and(
      eq(researchTasks.businessId, id),
      eq(researchTasks.taskType, "enrich_lead"),
      inArray(researchTasks.status, ["pending", "running"]),
    ),
    columns: { id: true },
  });
  const dmContact = lead.contacts.find(
    (c) => c.isDecisionMaker && c.name && (c.email || c.phone),
  );
  const bestVerifiedContact = dmContact
    ? `${dmContact.name}${dmContact.role ? ` (${dmContact.role})` : ""}` +
      `${dmContact.email ? ` · ${dmContact.email}` : dmContact.phone ? ` · ${dmContact.phone}` : ""}`
    : null;

  const latestRun = lead.qualificationRuns[0] ?? null;
  const draftAction = requestDraft.bind(null, id);
  const researchAction = requestResearch.bind(null, id);
  const notesAction = saveLeadNotes.bind(null, id);

  const sortedPages = [...lead.pages].sort((a, b) => pagePriority(a.url) - pagePriority(b.url));
  const pageByUrl = new Map(lead.pages.map((p) => [p.url, p]));
  const factsByPageUrl = new Map<string, typeof lead.facts>();
  for (const fact of lead.facts) {
    if (fact.sourceUrl) {
      const list = factsByPageUrl.get(fact.sourceUrl) ?? [];
      list.push(fact);
      factsByPageUrl.set(fact.sourceUrl, list);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{lead.name}</h1>
        <ScoreBadge score={lead.score} />
        <StatusBadge status={lead.status} />
        {lead.validationStatus !== "valid" && <ValidationBadge status={lead.validationStatus} />}
        {lead.validationOverridden && (
          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300">
            manually overridden
          </span>
        )}
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
            <LeadActions
              businessId={id}
              validationStatus={lead.validationStatus}
              validationOverridden={lead.validationOverridden}
              failedGates={(lead.validationReasons ?? []) as string[]}
            />
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
          {!lead.contacts.some((c) => c.isDecisionMaker && c.name) && lead.contacts.length > 0 && (
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Decision-maker not identified.
            </p>
          )}
          <ul className="space-y-2">
            {lead.contacts.map((c) => (
              <li key={c.id} className="border-b border-gray-100 dark:border-gray-800 pb-2 last:border-0">
                <div className="font-medium">
                  {c.name ?? "(unnamed contact)"}
                  {c.role && <span className="font-normal text-gray-500 dark:text-gray-400"> — {c.role}</span>}
                  {c.isDecisionMaker ? (
                    <span className="ml-1 rounded bg-blue-50 px-1.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      verified decision-maker
                    </span>
                  ) : (
                    c.name &&
                    c.method === "auto" && (
                      <span className="ml-1 rounded bg-yellow-50 px-1.5 text-xs text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400">
                        unverified — not used for outreach
                      </span>
                    )
                  )}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  confidence: {c.nameConfidence ?? "n/a"} · method: {c.method}
                  {c.sourceUrl && (
                    <>
                      {" · "}
                      <a
                        href={c.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Open source page
                      </a>
                    </>
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

      <LeadCorrections
        businessId={id}
        profile={{
          name: lead.name,
          phone: lead.phone ?? "",
          email: lead.email ?? "",
          address: lead.address ?? "",
          city: lead.city ?? "",
          state: lead.state ?? "",
          industry: lead.industry ?? "",
          summary: lead.summary ?? "",
        }}
        contacts={lead.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          roleType: c.roleType,
          email: c.email,
          phone: c.phone,
          isDecisionMaker: c.isDecisionMaker,
          method: c.method,
        }))}
      />

      <EnrichmentSection
        businessId={id}
        enrichable={isEnrichable(lead.status, lead.validationStatus, lead.validationOverridden)}
        bestVerifiedContact={bestVerifiedContact}
        run={enrichmentRun ?? null}
        evidence={enrichmentRun?.evidence ?? []}
        contacts={enrichmentRun?.contacts ?? []}
        usage={enrichmentRun?.usage ?? []}
        taskQueued={Boolean(queuedEnrichment)}
      />

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Validation</h2>
        <ValidationPanel business={lead} />
        {overrides.length > 0 && (
          <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800">
            <h3 className="mb-1 font-medium text-yellow-800 dark:text-yellow-300">
              Manual overrides
            </h3>
            <ul className="space-y-1 text-xs">
              {overrides.map((o) => (
                <li key={o.id}>
                  {o.createdAt.toLocaleString()} — {o.overriddenBy} overrode{" "}
                  <strong>{o.previousStatus.replaceAll("_", " ")}</strong>
                  {(o.failedGates as string[]).length > 0 && (
                    <> (failed: {(o.failedGates as string[]).join(", ")})</>
                  )}
                  : “{o.reason}”
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">
          Qualification{" "}
          {latestRun &&
            `— score ${latestRun.totalScore} (v${latestRun.scoringVersion}, ${latestRun.createdAt.toLocaleDateString()})`}
        </h2>
        {!latestRun && <p className="text-gray-500 dark:text-gray-400">Not scored yet.</p>}
        {latestRun && (
          <div className="flex flex-wrap gap-1.5">
            {latestRun.evidence.map((e) => {
              const page = e.sourceUrl ? pageByUrl.get(e.sourceUrl) : null;
              return (
                <EvidenceChip
                  key={e.id}
                  evidence={e}
                  businessDomain={lead.domain}
                  pageInfo={
                    page
                      ? {
                          httpStatus: page.httpStatus,
                          fetchedAt: page.fetchedAt,
                          finalUrl: (page.extractionMeta as { final_url?: string } | null)
                            ?.final_url,
                        }
                      : null
                  }
                />
              );
            })}
          </div>
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
          <h2 className="mb-2 font-medium">Crawled pages ({sortedPages.length})</h2>
          {sortedPages.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">No pages stored.</p>
          )}
          <ul className="space-y-1">
            {sortedPages.map((p) => {
              const meta = (p.extractionMeta ?? {}) as { final_url?: string; error?: string };
              const pageFacts = factsByPageUrl.get(p.url) ?? [];
              return (
                <li key={p.id}>
                  <details>
                    <summary className="cursor-pointer">
                      {p.title ?? p.url}{" "}
                      <span
                        className={`text-xs ${
                          p.httpStatus !== null && p.httpStatus >= 400
                            ? "text-red-600 dark:text-red-400"
                            : "text-gray-400 dark:text-gray-500"
                        }`}
                      >
                        (HTTP {p.httpStatus ?? "?"}, {p.fetchedAt.toLocaleDateString()}
                        {p.crawlAllowed ? "" : ", robots disallowed"}
                        {meta.final_url ? ", redirected" : ""})
                      </span>
                    </summary>
                    <div className="ml-4 mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                      <div className="break-all">URL: {p.url}</div>
                      {meta.final_url && (
                        <div className="break-all text-yellow-700 dark:text-yellow-400">
                          Final URL after redirect: {meta.final_url}
                        </div>
                      )}
                      {meta.error && (
                        <div className="text-red-600 dark:text-red-400">Error: {meta.error}</div>
                      )}
                      <div>Content hash: {p.contentHash ?? "—"}</div>
                      <div>
                        Facts from this page ({pageFacts.length}):{" "}
                        {pageFacts.map((f) => f.factKey).join(", ") || "none"}
                      </div>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Open page
                      </a>
                    </div>
                  </details>
                </li>
              );
            })}
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
