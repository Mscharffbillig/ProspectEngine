import { and, desc, eq, lte } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { followUpTasks, outreachDrafts } from "@/db/schema";
import { DraftCard } from "@/components/draft-card";
import { completeFollowUp } from "@/lib/actions/outreach";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [drafts, sent, followUps] = await Promise.all([
    db().query.outreachDrafts.findMany({
      where: eq(outreachDrafts.status, "draft"),
      with: { business: { columns: { name: true } } },
      orderBy: desc(outreachDrafts.createdAt),
    }),
    db().query.outreachDrafts.findMany({
      where: eq(outreachDrafts.status, "sent"),
      with: { business: { columns: { name: true } } },
      orderBy: desc(outreachDrafts.sentAt),
      limit: 20,
    }),
    db().query.followUpTasks.findMany({
      where: and(eq(followUpTasks.status, "pending"), lte(followUpTasks.dueDate, today)),
      with: { business: { columns: { name: true } } },
      orderBy: followUpTasks.dueDate,
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Outreach queue</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Messages are never sent automatically. Copy a draft into your own email client, then mark it
        sent to start follow-up reminders (4 and 10 days).
      </p>

      {followUps.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Follow-ups due</h2>
          <ul className="space-y-2">
            {followUps.map((f) => {
              const doneAction = completeFollowUp.bind(null, f.id, f.businessId);
              return (
                <li key={f.id} className="card flex items-center justify-between py-2 text-sm">
                  <span>
                    <Link
                      href={`/businesses/${f.businessId}`}
                      className="font-medium hover:underline"
                    >
                      {f.business?.name ?? "Business"}
                    </Link>{" "}
                    — {f.kind.replaceAll("_", " ")} due {f.dueDate}
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
        <h2 className="mb-2 font-medium">Drafts awaiting review ({drafts.length})</h2>
        {drafts.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No drafts. Approve a lead in the review queue or use “Generate outreach draft” on a
            business page (the worker must be running).
          </p>
        )}
        <div className="space-y-4">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} businessName={d.business?.name ?? "Business"} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Recently sent</h2>
        <div className="space-y-4">
          {sent.map((d) => (
            <DraftCard key={d.id} draft={d} businessName={d.business?.name ?? "Business"} />
          ))}
        </div>
      </section>
    </div>
  );
}
