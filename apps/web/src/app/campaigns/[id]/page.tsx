import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { businesses, campaigns, researchRuns } from "@/db/schema";
import { CampaignForm } from "@/components/campaign-form";
import { runCampaign, setCampaignStatus, updateCampaign } from "@/lib/actions/campaigns";
import { StatusBadge, ScoreBadge } from "@/components/badges";
import type { RunStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const campaign = await db().query.campaigns.findFirst({
    where: eq(campaigns.id, id),
    with: { industries: true, locations: true },
  });
  if (!campaign) notFound();

  const [runs, leads] = await Promise.all([
    db().query.researchRuns.findMany({
      where: eq(researchRuns.campaignId, id),
      orderBy: desc(researchRuns.startedAt),
      limit: 5,
    }),
    db().query.businesses.findMany({
      where: eq(businesses.campaignId, id),
      orderBy: [desc(sql`${businesses.score} nulls last`)],
      limit: 25,
    }),
  ]);

  const runAction = runCampaign.bind(null, id);
  const pauseAction = setCampaignStatus.bind(
    null,
    id,
    campaign.status === "paused" ? "active" : "paused",
  );
  const updateAction = updateCampaign.bind(null, id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{campaign.name}</h1>
        <StatusBadge status={campaign.status} />
        <form action={runAction}>
          <button type="submit" className="btn-primary">
            Run discovery
          </button>
        </form>
        <form action={pauseAction}>
          <button type="submit" className="btn-secondary">
            {campaign.status === "paused" ? "Resume" : "Pause"}
          </button>
        </form>
      </div>
      <p className="text-sm text-gray-500">
        “Run discovery” queues a task; the research worker must be running to process it (see
        Settings for worker status).
      </p>

      <section>
        <h2 className="mb-2 font-medium">Recent runs</h2>
        {runs.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {runs.map((run) => {
              const s = (run.stats ?? {}) as RunStats;
              return (
                <li key={run.id} className="card py-2">
                  {run.startedAt.toLocaleString()} — {run.status}
                  {run.error
                    ? ` — ${run.error}`
                    : run.status === "completed"
                      ? ` — ${s.new_businesses ?? 0} new, ${s.merged ?? 0} merged, ${
                          s.skipped_aggregators ?? 0
                        } directories skipped`
                      : ""}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No runs yet.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Businesses ({leads.length} shown)</h2>
        <div className="card p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="p-2 font-normal">Name</th>
                <th className="p-2 font-normal">Score</th>
                <th className="p-2 font-normal">Status</th>
                <th className="p-2 font-normal">Location</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((b) => (
                <tr key={b.id} className="border-b border-gray-100 last:border-0">
                  <td className="p-2">
                    <Link href={`/businesses/${b.id}`} className="hover:underline">
                      {b.name}
                    </Link>
                  </td>
                  <td className="p-2">
                    <ScoreBadge score={b.score} />
                  </td>
                  <td className="p-2">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="p-2">{[b.city, b.state].filter(Boolean).join(", ")}</td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-3 text-gray-500">
                    No businesses discovered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Edit campaign</h2>
        <CampaignForm
          action={updateAction}
          campaign={campaign}
          industries={campaign.industries.map((i) => i.industry)}
          locations={campaign.locations.map((l) => l.location)}
          submitLabel="Save changes"
        />
      </section>
    </div>
  );
}
