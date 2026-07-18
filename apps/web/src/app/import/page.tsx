import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { ImportForm } from "@/components/import-form";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const options = await db().select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
  return <ImportForm campaigns={options} />;
}
