import type { BusinessStatus } from "@/lib/types";

const STATUS_STYLES: Partial<Record<BusinessStatus, string>> = {
  qualified: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300",
  needs_review: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300",
  rejected: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  research_failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  contacted: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300",
  replied: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  do_not_contact: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  won: "bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-200",
  lost: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function StatusBadge({ status }: { status: BusinessStatus | string }) {
  const style =
    STATUS_STYLES[status as BusinessStatus] ??
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-sm text-gray-400 dark:text-gray-500">—</span>;
  const style =
    score >= 50
      ? "bg-green-600 text-white dark:bg-green-700"
      : score >= 30
        ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
        : score >= 0
          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300"
          : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-sm font-semibold ${style}`}>
      {score}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const style =
    confidence === "confirmed"
      ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
      : confidence === "high"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"
        : confidence === "medium"
          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300"
          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${style}`}>{confidence}</span>
  );
}
