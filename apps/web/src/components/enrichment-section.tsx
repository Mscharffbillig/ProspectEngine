"use client";

import { useState, useTransition } from "react";
import { enrichLead } from "@/lib/actions/enrichment";
import {
  CONTACT_READINESS_LABELS,
  EMAIL_TYPE_LABELS,
  VERIFICATION_LABELS,
  type EnrichmentRun,
  type ExternalContact,
  type ExternalEvidence,
  type ProviderUsage,
} from "@/lib/types";

interface Props {
  businessId: string;
  enrichable: boolean;
  bestVerifiedContact: string | null;
  run: EnrichmentRun | null;
  evidence: ExternalEvidence[];
  contacts: ExternalContact[];
  usage: ProviderUsage[];
  taskQueued: boolean;
}

type AiClaim = { text: string; evidence_ids: string[]; is_hypothesis?: boolean };
type AiAnalysis = {
  business_summary?: string;
  strongest_operational_signals?: AiClaim[];
  possible_workflow_problems?: AiClaim[];
  possible_custom_software_angles?: AiClaim[];
  existing_software_or_competitor_risk?: AiClaim[];
  disqualifiers?: AiClaim[];
  recommended_contact_path?: string;
  discovery_questions?: string[];
  unresolved_questions?: string[];
  overall_confidence?: string;
};

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {children}
    </a>
  );
}

function VerificationTag({ state }: { state: string }) {
  const tone =
    state === "confirmed"
      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
      : state === "conflicting" || state === "rejected"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
        : "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
  return (
    <span className={`rounded px-1.5 text-xs ${tone}`}>
      {VERIFICATION_LABELS[state] ?? state}
    </span>
  );
}

function Claims({ title, claims }: { title: string; claims?: AiClaim[] }) {
  if (!claims || claims.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5">
        {claims.map((c, i) => (
          <li key={i}>
            {c.is_hypothesis && (
              <span className="mr-1 rounded bg-purple-50 px-1 text-xs text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                hypothesis
              </span>
            )}
            {c.text}
            {c.evidence_ids.length > 0 && (
              <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                [{c.evidence_ids.join(", ")}]
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EnrichmentSection({
  businessId,
  enrichable,
  bestVerifiedContact,
  run,
  evidence,
  contacts,
  usage,
  taskQueued,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function trigger(force: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        await enrichLead(businessId, force);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Enrichment failed to start");
      }
    });
  }

  const stages = (run?.stages ?? {}) as Record<string, { status?: string; error?: string }>;
  const stageErrors = Object.entries(stages)
    .filter(([, s]) => s.status === "error")
    .map(([name, s]) => `${name.replaceAll("_", " ")}: ${s.error}`);
  const analysis = (run?.aiAnalysis ?? null) as AiAnalysis | null;
  const hunterContacts = contacts.filter((c) => c.source === "hunter");
  const researchContacts = contacts.filter((c) => c.source !== "hunter");

  return (
    <section className="card space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Enrichment</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            On-demand research into the best contact and a possible software angle. External
            findings are candidates/hypotheses until you confirm them — never facts, never
            auto-sent.
          </p>
        </div>
        <div className="flex gap-2">
          {enrichable ? (
            <>
              <button
                type="button"
                disabled={pending || taskQueued}
                className="btn-primary"
                onClick={() => trigger(false)}
              >
                {run ? "Enrich again" : "Enrich lead"}
              </button>
              {run && (
                <button
                  type="button"
                  disabled={pending || taskQueued}
                  className="btn-secondary"
                  onClick={() => trigger(true)}
                >
                  Force refresh
                </button>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Not eligible for enrichment.
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {taskQueued && (
        <p className="text-blue-600 dark:text-blue-400">
          Enrichment queued — the worker will process it shortly. Refresh to see results.
        </p>
      )}

      {!run && !taskQueued && (
        <p className="text-gray-500 dark:text-gray-400">Not yet enriched.</p>
      )}

      {run && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
              {run.status}
              {run.cacheHit ? " · cached" : ""}
            </span>
            {run.contactReadiness && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                {CONTACT_READINESS_LABELS[run.contactReadiness] ?? run.contactReadiness}
              </span>
            )}
            {run.completedAt && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Last enriched {new Date(run.completedAt).toLocaleString()}
              </span>
            )}
          </div>

          <div>
            <span className="text-gray-500 dark:text-gray-400">Best verified contact: </span>
            <span className="text-gray-900 dark:text-gray-100">
              {bestVerifiedContact ?? "none confirmed yet"}
            </span>
          </div>

          {stageErrors.length > 0 && (
            <div className="rounded bg-yellow-50 px-2 py-1 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
              Provider issues (other stages still ran): {stageErrors.join(" · ")}
            </div>
          )}

          {researchContacts.length > 0 && (
            <div>
              <h3 className="font-medium">Contact candidates (unverified)</h3>
              <ul className="space-y-1">
                {researchContacts.map((c) => (
                  <li key={c.id} className="border-b border-gray-100 pb-1 last:border-0 dark:border-gray-800">
                    <span className="font-medium">{c.name}</span>
                    {c.role && <span className="text-gray-500 dark:text-gray-400"> — {c.role}</span>}
                    <span className="ml-1 rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">
                      {c.roleType.replaceAll("_", " ")}
                    </span>{" "}
                    <VerificationTag state={c.verificationState} />
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {c.email && (
                        <>
                          {c.email}{" "}
                          {c.emailType && <>({EMAIL_TYPE_LABELS[c.emailType] ?? c.emailType}) </>}
                        </>
                      )}
                      via {c.source}
                      {c.sourceUrl && (
                        <>
                          {" · "}
                          <ExtLink href={c.sourceUrl}>source</ExtLink>
                        </>
                      )}
                    </div>
                    {c.excerpt && (
                      <div className="text-xs text-gray-400 dark:text-gray-500">“{c.excerpt}”</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hunterContacts.length > 0 && (
            <div>
              <h3 className="font-medium">Hunter results</h3>
              <ul className="space-y-1">
                {hunterContacts.map((c) => (
                  <li key={c.id} className="text-xs">
                    <span className="font-medium">{c.name}</span>
                    {c.role && <span className="text-gray-500 dark:text-gray-400"> — {c.role}</span>}
                    {c.email && (
                      <>
                        {" · "}
                        {c.email}{" "}
                        {c.emailType && <>({EMAIL_TYPE_LABELS[c.emailType] ?? c.emailType})</>}
                      </>
                    )}
                    {c.providerScore != null && <> · score {c.providerScore}</>}{" "}
                    <VerificationTag state={c.verificationState} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis && (
            <div className="space-y-2 rounded border border-gray-100 p-2 dark:border-gray-800">
              <h3 className="font-medium">
                AI opportunity brief{" "}
                <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                  (confidence: {analysis.overall_confidence ?? "low"}; hypotheses, not facts)
                </span>
              </h3>
              {analysis.business_summary && <p>{analysis.business_summary}</p>}
              <Claims title="Strongest operational signals" claims={analysis.strongest_operational_signals} />
              <Claims title="Possible workflow problems" claims={analysis.possible_workflow_problems} />
              <Claims title="Possible custom-software angles" claims={analysis.possible_custom_software_angles} />
              <Claims title="Existing software / competitor risk" claims={analysis.existing_software_or_competitor_risk} />
              <Claims title="Disqualifiers" claims={analysis.disqualifiers} />
              {analysis.recommended_contact_path && (
                <p>
                  <span className="text-gray-500 dark:text-gray-400">Recommended contact path: </span>
                  {analysis.recommended_contact_path}
                </p>
              )}
              {analysis.discovery_questions && analysis.discovery_questions.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Discovery questions
                  </h4>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {analysis.discovery_questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {(analysis?.unresolved_questions?.length ?? 0) > 0 && (
            <div>
              <h3 className="font-medium">Unresolved questions</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-gray-700 dark:text-gray-300">
                {analysis!.unresolved_questions!.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {evidence.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                Public research sources ({evidence.length})
              </summary>
              <ul className="mt-1 space-y-1">
                {evidence.map((e) => (
                  <li key={e.id} className="text-xs">
                    <VerificationTag state={e.verificationState} />{" "}
                    {e.url ? <ExtLink href={e.url}>{e.title || e.url}</ExtLink> : e.title}
                    {e.domain && <span className="text-gray-400 dark:text-gray-500"> · {e.domain}</span>}
                    {e.snippet && (
                      <div className="text-gray-500 dark:text-gray-400">“{e.snippet}”</div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {usage.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-500 dark:text-gray-400">
                API usage
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {usage.map((u) => (
                  <li key={u.id}>
                    {u.provider}/{u.operation}: {u.requestCount} request(s)
                    {u.model ? ` · ${u.model}` : ""}
                    {u.inputTokens != null ? ` · in ${u.inputTokens}` : ""}
                    {u.outputTokens != null ? ` · out ${u.outputTokens}` : ""} ·{" "}
                    {u.success ? "ok" : `failed${u.error ? `: ${u.error}` : ""}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
