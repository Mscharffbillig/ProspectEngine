import type { Business, ValidationChecks } from "@/lib/types";
import { VALIDATION_CHECK_LABELS } from "@/lib/types";

export function ValidationBadge({ status }: { status: string }) {
  const style =
    status === "valid"
      ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
      : status === "invalid"
        ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
        : status === "pending_validation"
          ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ValidationPanel({ business }: { business: Business }) {
  const checks = (business.validationChecks ?? {}) as ValidationChecks;
  const reasons = (business.validationReasons ?? []) as string[];
  const entries = Object.entries(checks);
  if (entries.length === 0 && reasons.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Not validated yet (runs during scoring).
      </p>
    );
  }
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ValidationBadge status={business.validationStatus} />
        {business.nameConfidence && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            identity: {business.nameConfidence}
            {business.nameSource ? ` via ${business.nameSource.replaceAll("_", " ")}` : ""}
          </span>
        )}
      </div>
      <ul className="space-y-0.5">
        {entries.map(([key, check]) => (
          <li key={key} className="flex items-start gap-1.5">
            <span aria-hidden className={check.passed ? "text-green-600" : "text-red-600"}>
              {check.passed ? "✓" : "✗"}
            </span>
            <span>
              {VALIDATION_CHECK_LABELS[key] ?? key.replaceAll("_", " ")}
              <span className="text-gray-500 dark:text-gray-400"> — {check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {reasons.length > 0 && (
        <p className="text-xs text-red-700 dark:text-red-400">
          Gate failures: {reasons.map((r) => r.replaceAll("_", " ")).join(", ")}
        </p>
      )}
    </div>
  );
}
