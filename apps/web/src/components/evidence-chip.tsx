import type { QualificationEvidence } from "@/lib/types";

/** Scoring badge whose supporting evidence expands on click. */
export function EvidenceChip({ evidence }: { evidence: QualificationEvidence }) {
  const positive = evidence.points >= 0;
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
      </summary>
      <div className="mt-1 max-w-md rounded border border-gray-200 bg-white p-2 text-xs shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">
          confidence: {evidence.confidence ?? "unknown"}
        </div>
        {evidence.evidence && (
          <div className="mt-0.5 text-gray-700 dark:text-gray-300">“{evidence.evidence}”</div>
        )}
        {evidence.sourceUrl && (
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            source page
          </a>
        )}
      </div>
    </details>
  );
}
