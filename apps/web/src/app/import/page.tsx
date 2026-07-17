"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseCsv, rowsToObjects } from "@/lib/csv";
import { commitImport, type ImportCommitResult } from "@/lib/actions/import";

interface CampaignOption {
  id: string;
  name: string;
}

const PREVIEW_COLUMNS = [
  "company_name",
  "website",
  "phone",
  "city",
  "state",
  "industry",
  "contact_name",
  "email",
  "source",
];

export default function ImportPage() {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .from("campaigns")
      .select("id, name")
      .then(({ data }) => setCampaigns(data ?? []));
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setResult(null);
    setParseError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setParseError("CSV needs a header row and at least one data row.");
        setRecords([]);
        return;
      }
      const { records, unmappedHeaders } = rowsToObjects(rows);
      setRecords(records);
      setUnmapped(unmappedHeaders);
    } catch {
      setParseError("Could not read that file as CSV.");
    }
  }

  async function handleImport() {
    setBusy(true);
    setResult(null);
    try {
      const res = await commitImport(filename, campaignId || null, records);
      setResult(res);
      if (res.jobId) setRecords([]);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Import failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">CSV import</h1>
      <p className="text-sm text-gray-500">
        Supported columns: company_name (required), website, phone, city, state, industry,
        contact_name, email, source. The worker normalizes and deduplicates rows after import.
      </p>

      <div className="card space-y-3">
        <div>
          <label htmlFor="file" className="label">
            CSV file
          </label>
          <input id="file" type="file" accept=".csv,text/csv" onChange={handleFile} />
        </div>
        <div>
          <label htmlFor="campaign" className="label">
            Assign to campaign (optional)
          </label>
          <select
            id="campaign"
            className="field"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">No campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {parseError && (
        <p role="alert" className="text-sm text-red-600">
          {parseError}
        </p>
      )}
      {unmapped.length > 0 && (
        <p className="text-sm text-yellow-700">
          Ignored unrecognized columns: {unmapped.join(", ")}
        </p>
      )}

      {records.length > 0 && (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  {PREVIEW_COLUMNS.map((c) => (
                    <th key={c} className="p-2 font-normal">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    {PREVIEW_COLUMNS.map((c) => (
                      <td key={c} className="p-2">
                        {r[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" disabled={busy} className="btn-primary" onClick={handleImport}>
              {busy ? "Importing…" : `Import ${records.length} rows`}
            </button>
            {records.length > 10 && (
              <span className="text-sm text-gray-500">Previewing first 10 rows.</span>
            )}
          </div>
        </>
      )}

      {result?.error && (
        <p role="alert" className="text-sm text-red-600">
          {result.error}
        </p>
      )}
      {result?.jobId && (
        <div className="card text-sm">
          <p className="text-green-700">
            Queued {result.accepted} rows for import. The worker will normalize and deduplicate
            them shortly.
          </p>
          {result.rejected && result.rejected.length > 0 && (
            <p className="mt-1 text-yellow-700">
              {result.rejected.length} row(s) skipped:{" "}
              {result.rejected
                .slice(0, 5)
                .map((r) => `row ${r.row}: ${r.error}`)
                .join("; ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
