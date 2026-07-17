import { CampaignForm } from "@/components/campaign-form";
import { createCampaign } from "@/lib/actions/campaigns";

export default function NewCampaignPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New campaign</h1>
      <CampaignForm action={createCampaign} submitLabel="Create campaign" />
    </div>
  );
}
