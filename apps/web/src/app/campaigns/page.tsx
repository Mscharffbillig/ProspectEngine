import { desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { campaigns } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const rows = await db().query.campaigns.findMany({ orderBy: desc(campaigns.createdAt) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Campaigns</h1>
        <Link href="/campaigns/new" className="btn-primary">
          New campaign
        </Link>
      </div>
      <div className="card p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="p-3 font-normal">Name</th>
              <th className="p-3 font-normal">Status</th>
              <th className="p-3 font-normal">Min score</th>
              <th className="p-3 font-normal">Last run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0">
                <td className="p-3">
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="p-3">{c.status}</td>
                <td className="p-3">{c.minQualificationScore}</td>
                <td className="p-3">{c.lastRunAt ? c.lastRunAt.toLocaleString() : "never"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-gray-500">
                  No campaigns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
