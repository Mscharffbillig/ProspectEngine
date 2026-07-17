import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ResearchRun } from "@/lib/types";

export const dynamic = "force-dynamic";

async function count(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  filter: (q: any) => any,
): Promise<number> {
  const { count: n } = await filter(supabase.from(table).select("id", { count: "exact", head: true }));
  return n ?? 0;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    awaitingReview,
    qualified,
    outreachDue,
    followUpsDue,
    replies,
    interviews,
    totalBusinesses,
  ] = await Promise.all([
    count(supabase, "businesses", (q) => q.in("status", ["qualified", "needs_review"])),
    count(supabase, "businesses", (q) => q.eq("status", "qualified")),
    count(supabase, "outreach_drafts", (q) => q.eq("status", "draft")),
    count(supabase, "follow_up_tasks", (q) => q.eq("status", "pending").lte("due_date", today)),
    count(supabase, "businesses", (q) => q.eq("status", "replied")),
    count(supabase, "businesses", (q) => q.eq("status", "interview_scheduled")),
    count(supabase, "businesses", (q) => q.not("status", "in", '("rejected","do_not_contact")')),
  ]);

  const { data: runs } = await supabase
    .from("research_runs")
    .select("*, campaigns(name)")
    .order("started_at", { ascending: false })
    .limit(5);

  const stats: [string, number, string][] = [
    ["Awaiting review", awaitingReview, "/review"],
    ["Qualified leads", qualified, "/review"],
    ["Outreach drafts", outreachDue, "/outreach"],
    ["Follow-ups due", followUpsDue, "/outreach"],
    ["Replies", replies, "/outreach"],
    ["Interviews scheduled", interviews, "/outreach"],
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value, href]) => (
          <Link key={label} href={href} className="card hover:border-blue-300">
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-sm text-gray-500">{label}</div>
          </Link>
        ))}
      </div>

      <section className="card">
        <h2 className="mb-2 font-medium">Recent research runs</h2>
        {runs && runs.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-4 font-normal">Campaign</th>
                <th className="py-1 pr-4 font-normal">Started</th>
                <th className="py-1 pr-4 font-normal">Status</th>
                <th className="py-1 font-normal">Results</th>
              </tr>
            </thead>
            <tbody>
              {(runs as (ResearchRun & { campaigns: { name: string } | null })[]).map((run) => (
                <tr key={run.id} className="border-t border-gray-100">
                  <td className="py-1.5 pr-4">{run.campaigns?.name ?? "—"}</td>
                  <td className="py-1.5 pr-4">{new Date(run.started_at).toLocaleString()}</td>
                  <td className="py-1.5 pr-4">{run.status}</td>
                  <td className="py-1.5 text-gray-600">
                    {run.error
                      ? run.error
                      : `${run.stats?.new_businesses ?? 0} new, ${run.stats?.merged ?? 0} merged, ${
                          run.stats?.raw_results ?? 0
                        } raw results`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">
            No runs yet. Create a campaign and click “Run discovery”, then start the worker.
          </p>
        )}
      </section>

      <p className="text-sm text-gray-500">
        {totalBusinesses} active businesses tracked across all campaigns.
      </p>
    </div>
  );
}
