import { getWorkUser } from "@/lib/work-auth";
import { getPitEvents, getPitItems } from "@/lib/pit-data";
import { PageHead } from "@/components/fab-ui";
import { PitSetup } from "@/components/pit-setup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pit setup · 3256 Tools" };

export default async function PitSetupPage() {
  const [events, items, user] = await Promise.all([getPitEvents(), getPitItems(), getWorkUser()]);
  return (
    <>
      <PageHead eyebrow="Pit" title="Setup" />
      <PitSetup events={events} items={items} canWrite={user?.role !== "viewer"} />
    </>
  );
}
