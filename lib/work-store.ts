import type { WorkData, WorkItem, WorkKind } from "./work";

/** One edit sent to the server. The revision is filled in at send time, from the newest row the browser has. */
export type WorkChange = {
  id?: string;
  kind?: WorkKind;
  title?: string;
  data?: WorkData;
  archived?: boolean;
  deleted?: boolean;
};

/** Rows the server returned from a save win over an older page snapshot; rows the snapshot hasn't seen yet go last. */
export function mergeItems(snapshot: WorkItem[], saved: Map<string, WorkItem>): WorkItem[] {
  if (!saved.size) return snapshot;
  const seen = new Set<string>();
  const merged = snapshot.map((i) => {
    seen.add(i.id);
    const s = saved.get(i.id);
    return s && s.revision > i.revision ? s : i;
  });
  for (const s of saved.values()) if (!seen.has(s.id)) merged.push(s);
  return merged;
}

/** Shows edits that are still on their way to the server. */
export function applyChanges(items: WorkItem[], changes: WorkChange[], now: string): WorkItem[] {
  const byId = new Map<string, WorkChange[]>();
  for (const c of changes) if (c.id) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  if (!byId.size) return items;
  return items.map((i) => {
    let next = i;
    for (const c of byId.get(i.id) ?? [])
      next = {
        ...next,
        ...(c.title !== undefined ? { title: c.title } : {}),
        data: { ...next.data, ...c.data },
        ...(c.deleted !== undefined ? { deleted_at: c.deleted ? now : null } : {}),
        ...(c.archived !== undefined ? { archived: c.archived } : {}),
      };
    return next;
  });
}

/**
 * When a save is rejected because a teammate saved first, it can be re-sent on their revision
 * as long as they didn't touch the same fields (or trash/archive the item).
 */
export function canRebase(change: WorkChange, base: WorkItem | undefined, fresh: WorkItem): boolean {
  if (!base) return false;
  if (!!base.deleted_at !== !!fresh.deleted_at || base.archived !== fresh.archived) return false;
  if (change.title !== undefined && base.title !== fresh.title) return false;
  const before = base.data as Record<string, unknown>;
  const after = fresh.data as Record<string, unknown>;
  return Object.keys(change.data ?? {}).every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]));
}

/** Only the properties a form actually changed, so saving it can't undo a teammate's edit to the others. */
export function changedData(next: WorkData, previous: WorkData): WorkData {
  const before = previous as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
  ) as WorkData;
}

export type SaveResult = { ok: true; items: WorkItem[] } | { ok: false; error: string };
/** What the server action answers; `current` carries the newer rows when a teammate saved first. */
export type SaveReply = SaveResult | { ok: false; error: string; current?: WorkItem[] };

/**
 * Sends saves to the server one at a time, each against the newest revision this browser has seen,
 * so edits made in quick succession never reject each other.
 */
export function createSaveQueue(options: {
  send: (changes: (WorkChange & { revision?: number })[]) => Promise<SaveReply>;
  /** The row as the latest page snapshot has it. */
  snapshot: (id: string) => WorkItem | undefined;
  /** Every row the server has handed back so far, after each reply. */
  onRows: (rows: Map<string, WorkItem>) => void;
}) {
  const rows = new Map<string, WorkItem>();
  let last: Promise<unknown> = Promise.resolve();
  const newest = (id: string) => {
    const mine = rows.get(id);
    const theirs = options.snapshot(id);
    return mine && (!theirs || mine.revision >= theirs.revision) ? mine : theirs;
  };
  const accept = (incoming: WorkItem[]) => {
    for (const row of incoming) {
      const have = rows.get(row.id);
      if (!have || row.revision >= have.revision) rows.set(row.id, row);
    }
    options.onRows(rows);
  };
  const send = async (changes: WorkChange[]): Promise<SaveReply> => {
    try {
      return await options.send(changes.map((c) => (c.id ? { ...c, revision: newest(c.id)?.revision } : c)));
    } catch {
      return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    }
  };
  async function run(changes: WorkChange[]): Promise<SaveResult> {
    const before = changes.map((c) => (c.id ? newest(c.id) : undefined));
    let reply = await send(changes);
    if (!reply.ok && "current" in reply && reply.current?.length) {
      // A teammate saved first. Take their rows, and re-send when they changed other fields than ours.
      const fresh = reply.current;
      accept(fresh);
      const clear = changes.every((c, n) => {
        const row = fresh.find((r) => r.id === c.id);
        return !row || canRebase(c, before[n], row);
      });
      if (clear) reply = await send(changes);
    }
    if (reply.ok) accept(reply.items);
    return reply.ok ? reply : { ok: false, error: reply.error };
  }
  return (changes: WorkChange[]) => {
    const result = last.then(() => run(changes));
    last = result;
    return result;
  };
}
