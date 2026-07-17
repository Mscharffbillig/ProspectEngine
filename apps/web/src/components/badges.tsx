import type { BusinessStatus } from "@/lib/types";

const STATUS_STYLES: Partial<Record<BusinessStatus, string>> = {
  qualified: "bg-green-100 text-green-800",
  approved: "bg-blue-100 text-blue-800",
  needs_review: "bg-yellow-100 text-yellow-800",
  rejected: "bg-gray-200 text-gray-600",
  research_failed: "bg-red-100 text-red-700",
  contacted: "bg-indigo-100 text-indigo-800",
  replied: "bg-emerald-100 text-emerald-800",
  do_not_contact: "bg-red-100 text-red-700",
  won: "bg-emerald-200 text-emerald-900",
  lost: "bg-gray-200 text-gray-600",
};

export function StatusBadge({ status }: { status: BusinessStatus | string }) {
  const style = STATUS_STYLES[status as BusinessStatus] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-sm text-gray-400">—</span>;
  const style =
    score >= 50
      ? "bg-green-600 text-white"
      : score >= 30
        ? "bg-green-100 text-green-800"
        : score >= 0
          ? "bg-yellow-100 text-yellow-800"
          : "bg-red-100 text-red-700";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-sm font-semibold ${style}`}>
      {score}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const style =
    confidence === "confirmed"
      ? "bg-green-100 text-green-800"
      : confidence === "high"
        ? "bg-blue-100 text-blue-800"
        : confidence === "medium"
          ? "bg-yellow-100 text-yellow-800"
          : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${style}`}>{confidence}</span>
  );
}
