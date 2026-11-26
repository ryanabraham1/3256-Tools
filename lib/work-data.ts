import "server-only";
import { getWorkUser, type WorkUser } from "./work-auth";
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
/**
 * The trimmed Work views (migration 20261122170000) when they exist, else the tables. The views
 * leave the raw Linear export copies on the server, ~70% of every read. Checked once per server
 * instance; a "missing" answer is re-checked after 10 minutes, so applying the migration takes
 * effect without a redeploy.
 */
let lite: { ok: boolean; at: number } | null = null;
async function workSource(): Promise<{ items: string; events: string }> {
  if (!lite || (!lite.ok && Date.now() - lite.at > 10 * 60_000)) {
    const { error } = await supabaseAdmin().from("work_items_lite").select("id").limit(1);
    lite = { ok: !error, at: Date.now() };
  }
  return lite.ok ? { items: "work_items_lite", events: "work_events_lite" } : { items: "work_items", events: "work_events" };
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
/**
 * Reads overlap the last one by this much, so a save whose transaction started before the
 * previous read but committed after it (its updated_at is the start time) is still picked up.
 */
const DELTA_OVERLAP_MS = 2 * 60_000;

/**
 * Only what changed since `since` (an earlier snapshot's `now`): items updated since then and all
 * of their events, events created since then, plus the small per-person tables. A background
 * refresh of an idle workspace is a few KB instead of the whole ~2 MB workspace (Supabase egress).
 */
async function getWorkSince(user: WorkUser, since: string): Promise<WorkSnapshot> {
  const db = supabaseAdmin();
  const t = await workSource();
  const now = new Date().toISOString();
  const from = new Date(Date.parse(since) - DELTA_OVERLAP_MS).toISOString();
  const [maintenance, items, created, receipts, robot, access, members] = await Promise.all([
    db.rpc("advance_work"),
    collect<WorkSnapshot["items"][number]>((a, b) =>
      db.from(t.items).select("*").gte("updated_at", from).order("number").range(a, b),
    ),
    collect<WorkSnapshot["events"][number]>(
      (a, b) =>
        db.from(t.events).select("*").gte("created_at", from).order("created_at", { ascending: false }).order("id").range(a, b),
      2000,
    ),
    collect<WorkSnapshot["receipts"][number]>((a, b) =>
      db.from("work_receipts").select("*").eq("member_id", user.memberId).order("event_id").range(a, b),
    ),
    robotIssues(),
    db.from("work_access").select("member_id,disabled"),
    db.from("work_items").select("id").eq("kind", "member"),
  ]);
  if (maintenance.error) throw maintenance.error;
  if (access.error) throw access.error;
  if (members.error) throw members.error;
  // Every event of a changed item, so edited and deleted updates show (mergeWorkDelta replaces them).
  const ids = items.map((i) => i.id);
  const theirs: WorkSnapshot["events"] = [];
  for (let n = 0; n < ids.length; n += 100) {
    const chunk = ids.slice(n, n + 100);
    theirs.push(
      ...(await collect<WorkSnapshot["events"][number]>((a, b) =>
        db.from(t.events).select("*").in("item_id", chunk).order("created_at", { ascending: false }).order("id").range(a, b),
      )),
    );
  }
  const events = [...new Map([...created, ...theirs].map((e) => [e.id, e])).values()];
  const active = new Set((access.data ?? []).filter((a) => !a.disabled && a.member_id).map((a) => a.member_id as string));
  const inactive = (members.data ?? []).map((m) => m.id as string).filter((id) => !active.has(id));
  for (const i of items) if (i.kind === "member" && !active.has(i.id)) i.inactive = true;
  return compactWorkSnapshot({ now, items, events, receipts, ...robot, delta: { since, inactive } });
}

/** Read Work for a user already verified by the page or route. */
export async function getWork(user: WorkUser, { full = false, since }: { full?: boolean; since?: string } = {}): Promise<WorkSnapshot> {
  try {
    if (!full && since && Number.isFinite(Date.parse(since))) return await getWorkSince(user, since);
    const db = supabaseAdmin();
    // Export (full) keeps everything, so it reads the tables.
    const t = full ? { items: "work_items", events: "work_events" } : await workSource();
    // Taken before the reads, so the next changes-only refresh can't skip a save made during them.
    const now = new Date().toISOString();
    // Recurring-task upkeep runs alongside the reads; anything it creates shows on the next refresh.
    const [maintenance, items, events, receipts, robot, access] = await Promise.all([
      db.rpc("advance_work"),
      collect<WorkSnapshot["items"][number]>((from, to) =>
        db.from(t.items).select("*").order("number").range(from, to),
      ),
      collect<WorkSnapshot["events"][number]>(
        (from, to) =>
          db
            .from(t.events)
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
      db.from("work_access").select("member_id,disabled"),
    ]);
    if (maintenance.error) throw maintenance.error;
    // People removed or disabled in Admin keep their member row (old tasks still name them) but can't be assigned new work.
    if (!access.error && access.data) {
      const active = new Set(access.data.filter((a) => !a.disabled && a.member_id).map((a) => a.member_id as string));
      for (const i of items) if (i.kind === "member" && !active.has(i.id)) i.inactive = true;
    }
    const snapshot = { now, items, events, receipts, ...robot };
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
    const t = await workSource();
    const items = await collect<WorkSnapshot["items"][number]>((from, to) =>
      db.from(t.items)
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
