import type { QualificationEvidence } from "@/lib/types";

interface Props {
  evidence: QualificationEvidence;
  businessDomain?: string | null;
  pageInfo?: { httpStatus: number | null; fetchedAt: Date; finalUrl?: string } | null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Scoring badge whose full evidence audit expands on click. */
export function EvidenceChip({ evidence, businessDomain, pageInfo }: Props) {
  const positive = evidence.points >= 0;
  const sourceHost = hostOf(evidence.sourceUrl);
  const flags: string[] = [];
  if (sourceHost && businessDomain && sourceHost !== businessDomain.replace(/^www\./, "")) {
    flags.push(`evidence from different domain: ${sourceHost}`);
  }
  if (pageInfo?.finalUrl) {
    const finalHost = hostOf(pageInfo.finalUrl);
    if (finalHost && finalHost !== sourceHost) {
      flags.push(`page redirected to ${finalHost}`);
    }
  }
  if (pageInfo && pageInfo.httpStatus !== null && pageInfo.httpStatus >= 400) {
    flags.push(`source page returned HTTP ${pageInfo.httpStatus}`);
  }
  if (evidence.confidence === "low") {
    flags.push("low-confidence evidence");
  }

  return (
    <details className="inline-block align-top">
      <summary
        className={`cursor-pointer list-none rounded-full px-2 py-0.5 text-xs ${
          positive
            ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
            : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
        }`}
      >
        {positive ? "+" : ""}
        {evidence.points} {evidence.label}
        {flags.length > 0 && (
          <span aria-label="evidence warning" title={flags.join("; ")}>
            {" "}
            ⚠
          </span>
        )}
      </summary>
      <div className="mt-1 max-w-md rounded border border-gray-200 bg-white p-2 text-xs shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">
          {evidence.category ?? "fit"} · confidence: {evidence.confidence ?? "unknown"} · method:{" "}
          {evidence.method ?? "heuristic"}
          {pageInfo && <> · crawled {pageInfo.fetchedAt.toLocaleDateString()}</>}
        </div>
        {evidence.evidence && (
          <div className="mt-0.5 text-gray-700 dark:text-gray-300">“{evidence.evidence}”</div>
        )}
        {flags.map((flag) => (
          <div key={flag} className="mt-0.5 text-yellow-700 dark:text-yellow-400">
            ⚠ {flag}
          </div>
        ))}
        {evidence.sourceUrl && (
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Open source page ({sourceHost ?? evidence.sourceUrl})
          </a>
        )}
      </div>
    </details>
  );
}
