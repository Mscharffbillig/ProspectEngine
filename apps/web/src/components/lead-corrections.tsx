"use client";

import { useState, useTransition } from "react";
import {
  CONTACT_ROLE_TYPES,
  deleteContact,
  saveContact,
  updateBusinessProfile,
  type ContactInput,
  type ProfileInput,
} from "@/lib/actions/corrections";

interface ContactRow {
  id: string;
  name: string | null;
  role: string | null;
  roleType: string;
  email: string | null;
  phone: string | null;
  isDecisionMaker: boolean;
  method: string;
}

interface Props {
  businessId: string;
  profile: ProfileInput;
  contacts: ContactRow[];
}

const BLANK_CONTACT: ContactInput = {
  name: "",
  role: "",
  roleType: "owner",
  email: "",
  phone: "",
  isDecisionMaker: true,
};

export function LeadCorrections({ businessId, profile, contacts }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [form, setForm] = useState<ProfileInput>(profile);
  const [contact, setContact] = useState<ContactInput | null>(null);

  function run(label: string, action: () => Promise<void>, after?: () => void) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        await action();
        setSaved(label);
        after?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  const field = (key: keyof ProfileInput) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <section className="card space-y-4 text-sm">
      <div>
        <h2 className="font-medium">Corrections (from your own research)</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Anything you fix here is kept through re-research; editing the name marks it as
          operator-confirmed. Saving re-runs validation and scoring.
        </p>
      </div>

      {/* ── business fields ─────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Business name</span>
          <input className="field" {...field("name")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Industry</span>
          <input className="field" {...field("industry")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Phone</span>
          <input className="field" {...field("phone")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Email</span>
          <input className="field" {...field("email")} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Address</span>
          <input className="field" {...field("address")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">City</span>
          <input className="field" {...field("city")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">State</span>
          <input className="field" {...field("state")} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Summary</span>
          <textarea className="field" rows={2} {...field("summary")} />
        </label>
      </div>
      <button
        type="button"
        disabled={pending}
        className="btn-primary"
        onClick={() => run("Business details saved", () => updateBusinessProfile(businessId, form))}
      >
        Save business details
      </button>

      {/* ── contacts ────────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium">Contacts you&apos;ve confirmed</h3>
          {!contact && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setContact({ ...BLANK_CONTACT })}
            >
              Add contact
            </button>
          )}
        </div>

        {contacts.length > 0 && (
          <ul className="mb-3 space-y-1">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-1 last:border-0 dark:border-gray-800"
              >
                <span className="font-medium">{c.name ?? "(unnamed)"}</span>
                {c.role && <span className="text-gray-500 dark:text-gray-400">— {c.role}</span>}
                {c.isDecisionMaker && (
                  <span className="rounded bg-blue-50 px-1.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    decision-maker
                  </span>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">({c.method})</span>
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                    onClick={() =>
                      setContact({
                        id: c.id,
                        name: c.name ?? "",
                        role: c.role ?? "",
                        roleType: c.roleType,
                        email: c.email ?? "",
                        phone: c.phone ?? "",
                        isDecisionMaker: c.isDecisionMaker,
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="text-red-600 hover:underline dark:text-red-400"
                    onClick={() =>
                      run("Contact removed", () => deleteContact(businessId, c.id))
                    }
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {contact && (
          <div className="grid gap-2 rounded-md border border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Name</span>
              <input
                className="field"
                value={contact.name}
                onChange={(e) => setContact({ ...contact, name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Role / title</span>
              <input
                className="field"
                value={contact.role}
                placeholder="e.g. Owner, Operations Manager"
                onChange={(e) => setContact({ ...contact, role: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Role type</span>
              <select
                className="field"
                value={contact.roleType}
                onChange={(e) => setContact({ ...contact, roleType: e.target.value })}
              >
                {CONTACT_ROLE_TYPES.map((rt) => (
                  <option key={rt} value={rt}>
                    {rt.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={contact.isDecisionMaker}
                onChange={(e) => setContact({ ...contact, isDecisionMaker: e.target.checked })}
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Decision-maker (used for outreach)
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Email</span>
              <input
                className="field"
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Phone</span>
              <input
                className="field"
                value={contact.phone}
                onChange={(e) => setContact({ ...contact, phone: e.target.value })}
              />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="button"
                disabled={pending || contact.name.trim().length === 0}
                className="btn-primary"
                onClick={() =>
                  run(
                    "Contact saved",
                    () => saveContact(businessId, contact),
                    () => setContact(null),
                  )
                }
              >
                {contact.id ? "Save contact" : "Add contact"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setContact(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-green-600 dark:text-green-400">
          {saved} — re-validation queued.
        </p>
      )}
    </section>
  );
}
