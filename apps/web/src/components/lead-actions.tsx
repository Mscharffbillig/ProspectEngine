"use client";

import { useState, useTransition } from "react";
import { approveLead, overrideValidation, rejectLead, snoozeLead } from "@/lib/actions/leads";
import { REJECTION_REASONS } from "@/lib/types";

interface Props {
  businessId: string;
  validationStatus?: string;
  validationOverridden?: boolean;
  failedGates?: string[];
}

export function LeadActions({
  businessId,
  validationStatus = "valid",
  validationOverridden = false,
  failedGates = [],
}: Props) {
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [reason, setReason] = useState<string>("poor_fit");
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canApprove = validationStatus === "valid" || validationOverridden;

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
      {canApprove ? (
        <button
          type="button"
          disabled={pending}
          className="btn-primary"
          onClick={() => run(() => approveLead(businessId))}
        >
          Approve
        </button>
      ) : showOverride ? (
        <span className="flex w-full flex-col gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-2 dark:border-yellow-800 dark:bg-yellow-950 sm:w-auto">
          <span className="text-xs text-yellow-900 dark:text-yellow-200">
            Validation is <strong>{validationStatus.replaceAll("_", " ")}</strong>
            {failedGates.length > 0 && (
              <> — failed: {failedGates.map((g) => g.replaceAll("_", " ")).join(", ")}</>
            )}
            . Overriding is recorded with your reason.
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <label className="sr-only" htmlFor={`override-${businessId}`}>
              Override reason
            </label>
            <input
              id={`override-${businessId}`}
              className="field w-64"
              placeholder="Why is this lead valid anyway?"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
            <button
              type="button"
              disabled={pending || overrideReason.trim().length < 5}
              className="btn-primary"
              onClick={() =>
                run(async () => {
                  await overrideValidation(businessId, overrideReason);
                  setShowOverride(false);
                })
              }
            >
              Confirm override
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowOverride(false)}>
              Cancel
            </button>
          </span>
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="btn-secondary border-yellow-400 text-yellow-800 dark:border-yellow-700 dark:text-yellow-300"
          onClick={() => setShowOverride(true)}
        >
          Override validation
        </button>
      )}
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
