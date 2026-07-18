import { and, count, desc, eq, inArray, lte, notInArray, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import Link from "next/link";
import { db } from "@/db";
import { businesses, followUpTasks, outreachDrafts, researchRuns } from "@/db/schema";
import type { RunStats } from "@/lib/types";

export const dynamic = "force-dynamic";

async function countWhere(table: PgTable, where: SQL | undefined): Promise<number> {
  const [row] = await db().select({ n: count() }).from(table).where(where);
  return row?.n ?? 0;
}

export default async function DashboardPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [awaitingReview, qualified, outreachDue, followUpsDue, replies, interviews, total] =
    await Promise.all([
      countWhere(businesses, inArray(businesses.status, ["qualified", "needs_review"])),
      countWhere(businesses, eq(businesses.status, "qualified")),
      countWhere(outreachDrafts, eq(outreachDrafts.status, "draft")),
      countWhere(
        followUpTasks,
        and(eq(followUpTasks.status, "pending"), lte(followUpTasks.dueDate, today)),
      ),
      countWhere(businesses, eq(businesses.status, "replied")),
      countWhere(businesses, eq(businesses.status, "interview_scheduled")),
      countWhere(businesses, notInArray(businesses.status, ["rejected", "do_not_contact"])),
    ]);

  const runs = await db().query.researchRuns.findMany({
    with: { campaign: { columns: { name: true } } },
    orderBy: desc(researchRuns.startedAt),
    limit: 5,
  });

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
        {runs.length > 0 ? (
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
              {runs.map((run) => {
                const s = (run.stats ?? {}) as RunStats;
                return (
                  <tr key={run.id} className="border-t border-gray-100">
                    <td className="py-1.5 pr-4">{run.campaign?.name ?? "—"}</td>
                    <td className="py-1.5 pr-4">{run.startedAt.toLocaleString()}</td>
                    <td className="py-1.5 pr-4">{run.status}</td>
                    <td className="py-1.5 text-gray-600">
                      {run.error
                        ? run.error
                        : `${s.new_businesses ?? 0} new, ${s.merged ?? 0} merged, ${
                            s.raw_results ?? 0
                          } raw results`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">
            No runs yet. Create a campaign and click “Run discovery”, then start the worker.
          </p>
        )}
      </section>

      <p className="text-sm text-gray-500">{total} active businesses tracked across all campaigns.</p>
    </div>
  );
}
