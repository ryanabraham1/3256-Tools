import { getWorkUser } from "@/lib/work-auth";
import { getPitChecks, getPitEvents, getPitItems, getPitProblems, getPitRuns } from "@/lib/pit-data";
import { PageHead } from "@/components/fab-ui";
import { PitHome } from "@/components/pit-home";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pit · 3256 Tools" };

export default async function PitPage() {
  const [events, items, user] = await Promise.all([getPitEvents(), getPitItems(), getWorkUser()]);
  const event = events.find((e) => e.active) ?? null;
  const [runs, problems] = await Promise.all([
    getPitRuns({ eventId: event?.id, limit: 60 }),
    getPitProblems({ eventId: event?.id }),
  ]);
  const checks = await getPitChecks(runs.map((r) => r.id));
  return (
    <>
      <PageHead eyebrow={event ? "Competition" : "Practice"} title={event?.name ?? "Pit checklist"} />
      <PitHome
        event={event}
        hasEvents={events.length > 0}
        items={items}
        runs={runs}
        checks={checks}
        problems={problems}
        canWrite={user?.role !== "viewer"}
      />
    </>
  );
}
