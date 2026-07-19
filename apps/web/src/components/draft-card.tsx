"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { discardDraft, markDraftSent, recordOptOut, recordReply } from "@/lib/actions/outreach";
import type { OutreachDraft } from "@/lib/types";

interface Props {
  draft: OutreachDraft;
  businessName: string;
}

export function DraftCard({ draft, businessName }: Props) {
  const [pending, startTransition] = useTransition();
  const [channel, setChannel] = useState("email");
  const [copied, setCopied] = useState(false);
  const [replyNotes, setReplyNotes] = useState("");
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

  async function copy() {
    await navigator.clipboard.writeText(draft.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <article className="card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/businesses/${draft.businessId}`} className="font-semibold hover:underline">
          {businessName}
        </Link>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {draft.status} · {draft.method} · {new Date(draft.createdAt).toLocaleString()}
        </span>
      </div>
      {draft.subject && <div className="text-sm font-medium">Subject: {draft.subject}</div>}
      <pre className="whitespace-pre-wrap rounded bg-gray-50 dark:bg-gray-950 p-3 font-sans text-sm">
        {draft.body}
      </pre>

      {draft.status === "draft" && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={copy}>
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <label htmlFor={`channel-${draft.id}`} className="sr-only">
            Channel
          </label>
          <select
            id={`channel-${draft.id}`}
            className="field w-auto"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="email">Email</option>
            <option value="contact_form">Contact form</option>
            <option value="phone">Phone</option>
            <option value="linkedin">LinkedIn (manual)</option>
            <option value="mail">Postal mail</option>
          </select>
          <button
            type="button"
            disabled={pending}
            className="btn-primary"
            onClick={() => run(() => markDraftSent(draft.id, draft.businessId, channel))}
          >
            Mark as sent
          </button>
          <button
            type="button"
            disabled={pending}
            className="btn-secondary"
            onClick={() => run(() => discardDraft(draft.id, draft.businessId))}
          >
            Discard
          </button>
        </div>
      )}

      {draft.status === "sent" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="field w-64"
            placeholder="Reply notes (optional)"
            value={replyNotes}
            onChange={(e) => setReplyNotes(e.target.value)}
          />
          <button
            type="button"
            disabled={pending}
            className="btn-primary"
            onClick={() => run(() => recordReply(draft.businessId, replyNotes))}
          >
            Record reply
          </button>
          <button
            type="button"
            disabled={pending}
            className="btn-danger"
            onClick={() => run(() => recordOptOut(draft.businessId))}
          >
            Opt-out / do not contact
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </article>
  );
}
