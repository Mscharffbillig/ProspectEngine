"use client";

import { useState, useTransition } from "react";
import { approveLead, rejectLead, snoozeLead } from "@/lib/actions/leads";
import { REJECTION_REASONS } from "@/lib/types";

export function LeadActions({ businessId }: { businessId: string }) {
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState<string>("poor_fit");
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="btn-primary"
        onClick={() => run(() => approveLead(businessId))}
      >
        Approve
      </button>
      {showReject ? (
        <span className="flex items-center gap-1">
          <label className="sr-only" htmlFor={`reason-${businessId}`}>
            Rejection reason
          </label>
          <select
            id={`reason-${businessId}`}
            className="field w-auto"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REJECTION_REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            className="btn-danger"
            onClick={() => run(() => rejectLead(businessId, reason))}
          >
            Confirm
          </button>
          <button type="button" className="btn-secondary" onClick={() => setShowReject(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="btn-danger"
          onClick={() => setShowReject(true)}
        >
          Reject
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        className="btn-secondary"
        onClick={() => run(() => snoozeLead(businessId, 7))}
      >
        Snooze 7d
      </button>
      {error && (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
