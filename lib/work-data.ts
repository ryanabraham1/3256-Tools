import "server-only";
import { getWorkUser, requireWorkUser } from "./work-auth";
import { supabaseAdmin } from "./supabase";
import type { PitProblem } from "./pit";
import type { WorkSnapshot } from "./work";
import { compactWorkSnapshot } from "./work-snapshot";
async function collect<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  maximum = Infinity,
): Promise<T[]> {
  const all: T[] = [];
  while (all.length < maximum) {
    const size = Math.min(500, maximum - all.length);
    const result = await page(all.length, all.length + size - 1);
    if (result.error) throw result.error;
    const batch = result.data ?? [];
    all.push(...batch);
    if (batch.length < size) break;
  }
  return all;
}
/** The pit problem log, shared with Work as "Robot issues". A missing table leaves the page empty rather than failing Work. */
async function robotIssues(): Promise<Pick<WorkSnapshot, "problems" | "pitEvents">> {
  const db = supabaseAdmin();
  const [problems, events] = await Promise.all([
    db.from("pit_problems").select("*").order("occurred_at", { ascending: false }).limit(2000),
    db.from("pit_events").select("id,name,active").order("starts_on", { ascending: false, nullsFirst: false }),
  ]);
  return {
    problems: (problems.data ?? []) as PitProblem[],
    pitEvents: (events.data ?? []) as WorkSnapshot["pitEvents"],
  };
}
export async function getWork(full = false): Promise<WorkSnapshot> {
  const user = await requireWorkUser();
  try {
    const db = supabaseAdmin();
    // Recurring-task upkeep runs alongside the reads; anything it creates shows on the next refresh.
    const [maintenance, items, events, receipts, robot] = await Promise.all([
      db.rpc("advance_work"),
      collect<WorkSnapshot["items"][number]>((from, to) =>
        db.from("work_items").select("*").order("number").range(from, to),
      ),
      collect<WorkSnapshot["events"][number]>(
        (from, to) =>
          db
            .from("work_events")
            .select("*")
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        2000,
      ),
      collect<WorkSnapshot["receipts"][number]>((from, to) =>
        db
          .from("work_receipts")
          .select("*")
          .eq("member_id", user.memberId)
          .order("event_id")
          .range(from, to),
      ),
      robotIssues(),
    ]);
    if (maintenance.error) throw maintenance.error;
    const snapshot = { now: new Date().toISOString(), items, events, receipts, ...robot };
    return full ? snapshot : compactWorkSnapshot(snapshot);
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e
        ? String(e.message)
        : String(e);
    return {
      now: new Date().toISOString(),
      items: [],
      events: [],
      receipts: [],
      error: /work_.*(exist|schema cache)/i.test(message)
        ? "Work needs its database migration. Apply the team_work migration to the linked Supabase project."
        : "Work couldn't load. Check your connection and try again.",
    };
  }
}

/** Read-only home preview; Work still requires its own authorized Google session. */
export async function getWorkHome() {
  try {
    const user = await getWorkUser();
    if (!user) return { state: "signed-out" as const, items: [], memberId: null };
    const db = supabaseAdmin();
    const signal = AbortSignal.timeout(5000);
    const items = await collect<WorkSnapshot["items"][number]>((from, to) =>
      db.from("work_items")
        .select("*")
        .in("kind", ["issue", "project", "initiative", "team"])
        .eq("archived", false)
        .is("deleted_at", null)
        .order("number")
        .range(from, to)
        .abortSignal(signal),
    );
    return { state: "ready" as const, items, memberId: user.memberId };
  } catch {
    return { state: "error" as const, items: [], memberId: null };
  }
}
