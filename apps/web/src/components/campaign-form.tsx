"use client";

import { useActionState } from "react";
import type { Campaign } from "@/lib/types";

interface Props {
  action: (
    prev: { error: string } | { ok: true } | null,
    formData: FormData,
  ) => Promise<{ error: string } | { ok: true } | null>;
  campaign?: Campaign;
  industries?: string[];
  locations?: string[];
  submitLabel: string;
}

function listValue(values?: string[]) {
  return (values ?? []).join("\n");
}

export function CampaignForm({ action, campaign, industries, locations, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="card max-w-2xl space-y-4">
      <div>
        <label htmlFor="name" className="label">
          Name
        </label>
        <input id="name" name="name" required className="field" defaultValue={campaign?.name} />
      </div>
      <div>
        <label htmlFor="description" className="label">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          className="field"
          defaultValue={campaign?.description ?? ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="industries" className="label">
            Target industries (one per line)
          </label>
          <textarea
            id="industries"
            name="industries"
            rows={5}
            required
            className="field"
            defaultValue={listValue(industries)}
          />
        </div>
        <div>
          <label htmlFor="locations" className="label">
            Target locations (one per line)
          </label>
          <textarea
            id="locations"
            name="locations"
            rows={5}
            required
            className="field"
            defaultValue={listValue(locations)}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="min_company_size" className="label">
            Min company size
          </label>
          <input
            id="min_company_size"
            name="min_company_size"
            type="number"
            min={0}
            className="field"
            defaultValue={campaign?.min_company_size ?? ""}
          />
        </div>
        <div>
          <label htmlFor="max_company_size" className="label">
            Max company size
          </label>
          <input
            id="max_company_size"
            name="max_company_size"
            type="number"
            min={0}
            className="field"
            defaultValue={campaign?.max_company_size ?? ""}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="include_keywords" className="label">
            Include keywords
          </label>
          <textarea
            id="include_keywords"
            name="include_keywords"
            rows={3}
            className="field"
            defaultValue={listValue(campaign?.include_keywords)}
          />
        </div>
        <div>
          <label htmlFor="exclude_keywords" className="label">
            Exclude keywords
          </label>
          <textarea
            id="exclude_keywords"
            name="exclude_keywords"
            rows={3}
            className="field"
            defaultValue={listValue(campaign?.exclude_keywords)}
          />
        </div>
        <div>
          <label htmlFor="preferred_characteristics" className="label">
            Preferred characteristics
          </label>
          <textarea
            id="preferred_characteristics"
            name="preferred_characteristics"
            rows={3}
            className="field"
            defaultValue={listValue(campaign?.preferred_characteristics)}
          />
        </div>
        <div>
          <label htmlFor="excluded_characteristics" className="label">
            Excluded characteristics
          </label>
          <textarea
            id="excluded_characteristics"
            name="excluded_characteristics"
            rows={3}
            className="field"
            defaultValue={listValue(campaign?.excluded_characteristics)}
          />
        </div>
      </div>
      <div>
        <label htmlFor="workflow_problems" className="label">
          Possible workflow problems to investigate
        </label>
        <textarea
          id="workflow_problems"
          name="workflow_problems"
          rows={4}
          className="field"
          defaultValue={listValue(campaign?.workflow_problems)}
        />
      </div>
      <div>
        <label htmlFor="geography" className="label">
          Search radius / geographic description
        </label>
        <input
          id="geography"
          name="geography"
          className="field"
          defaultValue={campaign?.geography ?? ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="max_candidates_per_run" className="label">
            Max candidates per run
          </label>
          <input
            id="max_candidates_per_run"
            name="max_candidates_per_run"
            type="number"
            min={1}
            max={500}
            className="field"
            defaultValue={campaign?.max_candidates_per_run ?? 50}
          />
        </div>
        <div>
          <label htmlFor="min_qualification_score" className="label">
            Min qualification score
          </label>
          <input
            id="min_qualification_score"
            name="min_qualification_score"
            type="number"
            className="field"
            defaultValue={campaign?.min_qualification_score ?? 30}
          />
        </div>
        <div>
          <label htmlFor="status" className="label">
            Status
          </label>
          <select id="status" name="status" className="field" defaultValue={campaign?.status ?? "active"}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ai_enabled" defaultChecked={campaign?.ai_enabled ?? false} />
        Enable AI analysis (requires configured AI provider)
      </label>

      {state && "error" in state && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state && "ok" in state && <p className="text-sm text-green-700">Saved.</p>}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
