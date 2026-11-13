import { getWorkUser } from "@/lib/work-auth";
import { getPitEvents, getPitItems, getPitProblems } from "@/lib/pit-data";
import { PageHead } from "@/components/fab-ui";
import { PitProblems } from "@/components/pit-problems";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pit problems · 3256 Tools" };

export default async function PitProblemsPage(props: PageProps<"/pit/problems">) {
  const sp = await props.searchParams;
  const [events, items, user] = await Promise.all([getPitEvents(), getPitItems(), getWorkUser()]);
  // Defaults to the active competition; ?event=all shows every one.
  const asked = typeof sp.event === "string" ? sp.event : undefined;
  const eventId = asked === "all" ? "" : (events.find((e) => e.id === asked) ?? events.find((e) => e.active))?.id ?? "";
  const problems = await getPitProblems({ eventId: eventId || undefined });
  return (
    <>
      <PageHead eyebrow="Pit" title="Problems" />
      <PitProblems problems={problems} items={items} events={events} eventId={eventId} canWrite={user?.role !== "viewer"} />
    </>
  );
}
