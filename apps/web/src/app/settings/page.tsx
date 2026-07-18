import { desc } from "drizzle-orm";
import { db } from "@/db";
import { qualificationRules, workerHeartbeats } from "@/db/schema";

export const dynamic = "force-dynamic";

function Status({ configured, label }: { configured: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between py-1.5">
      <span>{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          configured ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
        }`}
      >
        {configured ? "configured" : "not configured"}
      </span>
    </li>
  );
}

export default async function SettingsPage() {
  const [heartbeats, rules] = await Promise.all([
    db().query.workerHeartbeats.findMany({ orderBy: desc(workerHeartbeats.lastSeenAt) }),
    db().query.qualificationRules.findMany({ orderBy: desc(qualificationRules.points) }),
  ]);

  // Presence checks only — secret values never reach the browser.
  const neonConfigured = Boolean(process.env.DATABASE_URL);
  const neonAuthConfigured = Boolean(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID && process.env.STACK_SECRET_SERVER_KEY,
  );
  const braveConfigured = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  const hunterConfigured = Boolean(process.env.HUNTER_API_KEY);
  const aiConfigured = Boolean(
    process.env.AI_PROVIDER && (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
  );
  const demoMode = (process.env.DEMO_MODE ?? "true") !== "false";

  const staleMs = 2 * 60 * 1000;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Providers</h2>
        <ul className="divide-y divide-gray-100">
          <Status configured={neonConfigured} label="Neon Postgres (DATABASE_URL)" />
          <Status configured={neonAuthConfigured} label="Neon Auth (Stack)" />
          <Status configured={braveConfigured} label="Brave Search API" />
          <Status configured={hunterConfigured} label="Hunter email enrichment (optional)" />
          <Status configured={aiConfigured} label="AI provider (optional)" />
        </ul>
        {demoMode && (
          <p className="mt-2 rounded bg-blue-50 p-2 text-blue-800">
            Demo mode is on: discovery and crawling use local fixtures instead of live APIs. Set
            DEMO_MODE=false with a Brave Search key for live discovery.
          </p>
        )}
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Worker status</h2>
        {heartbeats.length === 0 && (
          <p className="text-gray-500">
            No worker has checked in yet. Start it with{" "}
            <code className="rounded bg-gray-100 px-1">python -m worker.main poll</code> in
            services/research-worker.
          </p>
        )}
        <ul className="space-y-1">
          {heartbeats.map((h) => {
            const info = (h.info ?? {}) as { mode?: string; demo_mode?: boolean };
            const alive = Date.now() - h.lastSeenAt.getTime() < staleMs;
            return (
              <li key={h.id} className="flex items-center justify-between">
                <span>
                  {h.id}{" "}
                  <span className="text-xs text-gray-400">
                    (mode: {info.mode ?? "?"}, demo: {String(info.demo_mode ?? "?")})
                  </span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    alive ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {alive ? "online" : `last seen ${h.lastSeenAt.toLocaleString()}`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Crawl settings</h2>
        <p className="text-gray-600">
          Depth 2, max 7 pages per site, per-domain delay, robots.txt respected. Adjust via worker
          environment variables (CRAWLER_USER_AGENT, CRAWLER_CONTACT_EMAIL, crawl limits in
          services/research-worker/worker/config.py).
        </p>
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 font-medium">Scoring rules</h2>
        <p className="mb-2 text-gray-500">
          Edit points or disable rules directly in the qualification_rules table (Neon Console SQL
          editor or any Postgres client); changes apply to the next scoring run.
        </p>
        <table className="w-full">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-3 font-normal">Rule</th>
              <th className="py-1 pr-3 font-normal">Points</th>
              <th className="py-1 font-normal">Active</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="py-1.5 pr-3">{r.label}</td>
                <td
                  className={`py-1.5 pr-3 font-mono ${r.points >= 0 ? "text-green-700" : "text-red-700"}`}
                >
                  {r.points >= 0 ? "+" : ""}
                  {r.points}
                </td>
                <td className="py-1.5">{r.active ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
