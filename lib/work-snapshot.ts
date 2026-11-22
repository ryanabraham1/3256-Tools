import type { WorkItem, WorkSnapshot } from "./work";
export function compactWorkItem(i: WorkItem): WorkItem {
  return { ...i, data: { ...i.data, source: i.data.source ? { ...i.data.source, raw: undefined } : undefined } };
}
/** Keep import provenance and full history in storage/export, not every navigation payload. */
export function compactWorkSnapshot(snapshot: WorkSnapshot): WorkSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map(compactWorkItem),
    events: snapshot.events.map(e => ({ ...e, data: Object.fromEntries(Object.entries(e.data).map(([key, value]) => {
      if (["before", "after"].includes(key)) {
        const record = value as WorkSnapshot["items"][number] | null;
        return [key, record ? { data: { status: record.data?.status } } : null];
      }
      if (key === "source" && value && typeof value === "object") return [key, { ...value, raw: undefined }];
      return [key, value];
    })) })),
  };
}

const newestFirst = (a: WorkSnapshot["events"][number], b: WorkSnapshot["events"][number]) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Folds a changes-only refresh into the snapshot on screen. Items the server sent replace
 * the ones here, and so do all of their events (that is how an edited or deleted update shows up).
 * Events stay capped at the newest 2,000, like a full read.
 */
export function mergeWorkDelta(have: WorkSnapshot, next: WorkSnapshot): WorkSnapshot {
  if (!next.delta) return next;
  const changed = new Map(next.items.map((i) => [i.id, i]));
  const items = have.items.map((i) => changed.get(i.id) ?? i);
  const known = new Set(have.items.map((i) => i.id));
  for (const i of next.items) if (!known.has(i.id)) items.push(i);
  items.sort((a, b) => a.number - b.number);
  const inactive = new Set(next.delta.inactive);
  for (let n = 0; n < items.length; n++) {
    const i = items[n];
    if (i.kind !== "member" || !!i.inactive === inactive.has(i.id)) continue;
    const { inactive: _drop, ...rest } = i;
    void _drop;
    items[n] = inactive.has(i.id) ? { ...rest, inactive: true } : rest;
  }
  const sent = new Set(next.events.map((e) => e.id));
  const events = have.events
    .filter((e) => !changed.has(e.item_id) && !sent.has(e.id))
    .concat(next.events)
    .sort(newestFirst)
    .slice(0, 2000);
  const { delta: _delta, ...rest } = next;
  void _delta;
  return { ...rest, items, events };
}
