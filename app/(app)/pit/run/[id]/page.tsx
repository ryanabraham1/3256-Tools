import { notFound } from "next/navigation";
import { getWorkUser } from "@/lib/work-auth";
import { getPitChecks, getPitEvents, getPitItems, getPitProblems, getPitRun } from "@/lib/pit-data";
import { PitRunView } from "@/components/pit-run";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checklist · 3256 Tools" };

export default async function PitRunPage(props: PageProps<"/pit/run/[id]">) {
  const { id } = await props.params;
  const run = await getPitRun(id);
  if (!run) notFound();
  const [items, checks, problems, events, user] = await Promise.all([
    getPitItems(),
    getPitChecks([run.id]),
    getPitProblems(),
    getPitEvents(),
    getWorkUser(),
  ]);
  return (
    <PitRunView
      run={run}
      items={items}
      checks={checks}
      problems={problems.filter((p) => !run.event_id || p.event_id === run.event_id)}
      areas={[...new Set(problems.map((p) => p.area).filter(Boolean))].sort()}
      eventName={events.find((e) => e.id === run.event_id)?.name ?? null}
      canWrite={user?.role !== "viewer"}
    />
  );
}
