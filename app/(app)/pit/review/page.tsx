import { getWorkUser } from "@/lib/work-auth";
import { getPitChecks, getPitEvents, getPitItems, getPitProblems, getPitRuns } from "@/lib/pit-data";
import { PageHead } from "@/components/fab-ui";
import { PitReview } from "@/components/pit-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pit review · 3256 Tools" };

export default async function PitReviewPage(props: PageProps<"/pit/review">) {
  const sp = await props.searchParams;
  const [events, items, user] = await Promise.all([getPitEvents(), getPitItems(), getWorkUser()]);
  // Defaults to the active (or most recent) competition; ?event=all reviews every one.
  const asked = typeof sp.event === "string" ? sp.event : undefined;
  const eventId = asked === "all" ? "" : (events.find((e) => e.id === asked) ?? events.find((e) => e.active) ?? events[0])?.id ?? "";
  const [runs, problems, checks] = await Promise.all([
    getPitRuns({ eventId: eventId || undefined, limit: 5000 }),
    getPitProblems({ eventId: eventId || undefined }),
    getPitChecks(),
  ]);
  return (
    <>
      <PageHead eyebrow="Post-competition" title="Review" />
      <PitReview events={events} eventId={eventId} items={items} runs={runs} checks={checks} problems={problems} canWrite={user?.role !== "viewer"} />
    </>
  );
}
