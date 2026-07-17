import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DraftCard } from "@/components/draft-card";
import { completeFollowUp } from "@/lib/actions/outreach";
import type { FollowUpTask, OutreachDraft } from "@/lib/types";

export const dynamic = "force-dynamic";

type DraftWithBusiness = OutreachDraft & { businesses: { name: string } | null };
type FollowUpWithBusiness = FollowUpTask & { businesses: { name: string } | null };

export default async function OutreachPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: drafts }, { data: sent }, { data: followUps }] = await Promise.all([
    supabase
      .from("outreach_drafts")
      .select("*, businesses(name)")
      .eq("status", "draft")
      .order("created_at", { ascending: false }),
    supabase
      .from("outreach_drafts")
      .select("*, businesses(name)")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(20),
    supabase
      .from("follow_up_tasks")
      .select("*, businesses(name)")
      .eq("status", "pending")
      .lte("due_date", today)
      .order("due_date"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Outreach queue</h1>
      <p className="text-sm text-gray-500">
        Messages are never sent automatically. Copy a draft into your own email client, then mark it
        sent to start follow-up reminders (4 and 10 days).
      </p>

      {(followUps ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Follow-ups due</h2>
          <ul className="space-y-2">
            {((followUps ?? []) as FollowUpWithBusiness[]).map((f) => {
              const doneAction = completeFollowUp.bind(null, f.id, f.business_id);
              return (
                <li key={f.id} className="card flex items-center justify-between py-2 text-sm">
                  <span>
                    <Link href={`/businesses/${f.business_id}`} className="font-medium hover:underline">
                      {f.businesses?.name ?? "Business"}
                    </Link>{" "}
                    — {f.kind.replaceAll("_", " ")} due {f.due_date}
                  </span>
                  <form action={doneAction}>
                    <button type="submit" className="btn-secondary">
                      Mark done
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-medium">Drafts awaiting review ({drafts?.length ?? 0})</h2>
        {(drafts ?? []).length === 0 && (
          <p className="text-sm text-gray-500">
            No drafts. Approve a lead in the review queue or use “Generate outreach draft” on a
            business page (the worker must be running).
          </p>
        )}
        <div className="space-y-4">
          {((drafts ?? []) as DraftWithBusiness[]).map((d) => (
            <DraftCard key={d.id} draft={d} businessName={d.businesses?.name ?? "Business"} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Recently sent</h2>
        <div className="space-y-4">
          {((sent ?? []) as DraftWithBusiness[]).map((d) => (
            <DraftCard key={d.id} draft={d} businessName={d.businesses?.name ?? "Business"} />
          ))}
        </div>
      </section>
    </div>
  );
}
