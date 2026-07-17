import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm } from "@/components/campaign-form";
import { runCampaign, setCampaignStatus, updateCampaign } from "@/lib/actions/campaigns";
import { StatusBadge, ScoreBadge } from "@/components/badges";
import type { Business, Campaign, ResearchRun } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) notFound();

  const [{ data: industries }, { data: locations }, { data: runs }, { data: leads }] =
    await Promise.all([
      supabase.from("campaign_industries").select("industry").eq("campaign_id", id),
      supabase.from("campaign_locations").select("location").eq("campaign_id", id),
      supabase
        .from("research_runs")
        .select("*")
        .eq("campaign_id", id)
        .order("started_at", { ascending: false })
        .limit(5),
      supabase
        .from("businesses")
        .select("*")
        .eq("campaign_id", id)
        .order("score", { ascending: false, nullsFirst: false })
        .limit(25),
    ]);

  const typedCampaign = campaign as Campaign;
  const runAction = runCampaign.bind(null, id);
  const pauseAction = setCampaignStatus.bind(
    null,
    id,
    typedCampaign.status === "paused" ? "active" : "paused",
  );
  const updateAction = updateCampaign.bind(null, id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{typedCampaign.name}</h1>
        <StatusBadge status={typedCampaign.status} />
        <form action={runAction}>
          <button type="submit" className="btn-primary">
            Run discovery
          </button>
        </form>
        <form action={pauseAction}>
          <button type="submit" className="btn-secondary">
            {typedCampaign.status === "paused" ? "Resume" : "Pause"}
          </button>
        </form>
      </div>
      <p className="text-sm text-gray-500">
        “Run discovery” queues a task; the research worker must be running to process it (see
        Settings for worker status).
      </p>

      <section>
        <h2 className="mb-2 font-medium">Recent runs</h2>
        {runs && runs.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {(runs as ResearchRun[]).map((run) => (
              <li key={run.id} className="card py-2">
                {new Date(run.started_at).toLocaleString()} — {run.status}
                {run.error
                  ? ` — ${run.error}`
                  : run.status === "completed"
                    ? ` — ${run.stats?.new_businesses ?? 0} new, ${run.stats?.merged ?? 0} merged, ${run.stats?.skipped_aggregators ?? 0} directories skipped`
                    : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No runs yet.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Businesses ({leads?.length ?? 0} shown)</h2>
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
              {((leads ?? []) as Business[]).map((b) => (
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
              {(leads ?? []).length === 0 && (
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
          campaign={typedCampaign}
          industries={(industries ?? []).map((i) => i.industry)}
          locations={(locations ?? []).map((l) => l.location)}
          submitLabel="Save changes"
        />
      </section>
    </div>
  );
}
