import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeWorkDelta, compactWorkSnapshot } from "../lib/work-snapshot.ts";

const item = (id, number, props = {}) => ({
  id, number, kind: "issue", title: id, data: {}, revision: 1, archived: false, deleted_at: null,
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...props,
});
const event = (id, item_id, created_at, body = "") => ({ id, item_id, actor: "A", type: "comment", body, created_at, data: {} });
const have = {
  now: "2026-11-22T10:00:00.000Z",
  items: [item("a", 1), item("b", 2), item("m", 3, { kind: "member" })],
  events: [event("e2", "b", "2026-11-20T00:00:00Z", "keep"), event("e1", "a", "2026-11-19T00:00:00Z", "old body")],
  receipts: [],
};

test("a changes-only refresh replaces changed items, adds new ones, and keeps the rest", () => {
  const next = {
    now: "2026-11-22T10:01:00.000Z",
    items: [item("a", 1, { revision: 2, title: "renamed" }), item("c", 9)],
    events: [event("e3", "c", "2026-11-22T10:00:30Z")],
    receipts: [{ event_id: "e3", member_id: "m", snoozed_until: null }],
    delta: { since: have.now, inactive: [] },
  };
  const merged = mergeWorkDelta(have, next);
  assert.equal(merged.delta, undefined);
  assert.equal(merged.now, next.now);
  assert.deepEqual(merged.items.map((i) => [i.id, i.title]), [["a", "renamed"], ["b", "b"], ["m", "m"], ["c", "c"]]);
  assert.deepEqual(merged.receipts, next.receipts);
  // a's events were resent as none: its old comment was deleted
  assert.deepEqual(merged.events.map((e) => e.id), ["e3", "e2"]);
});

test("edited updates arrive with their item and replace the old copy", () => {
  const next = {
    now: "2026-11-22T10:01:00.000Z",
    items: [item("a", 1)],
    events: [event("e1", "a", "2026-11-19T00:00:00Z", "edited body")],
    receipts: [],
    delta: { since: have.now, inactive: [] },
  };
  const merged = mergeWorkDelta(have, next);
  assert.deepEqual(merged.events.map((e) => [e.id, e.body]), [["e2", "keep"], ["e1", "edited body"]]);
});

test("people disabled in Admin turn inactive without their item changing, and back", () => {
  const off = mergeWorkDelta(have, { ...have, now: "2026-11-22T10:01:00.000Z", items: [], events: [], delta: { since: have.now, inactive: ["m"] } });
  assert.equal(off.items.find((i) => i.id === "m").inactive, true);
  const on = mergeWorkDelta(off, { ...off, now: "2026-11-22T10:02:00.000Z", items: [], events: [], delta: { since: off.now, inactive: [] } });
  assert.equal("inactive" in on.items.find((i) => i.id === "m"), false);
});

test("events stay newest first and capped at 2,000 like a full read", () => {
  const many = Array.from({ length: 2000 }, (_, n) => event(`old${n}`, "b", `2026-10-01T00:00:${String(n % 60).padStart(2, "0")}Z`));
  const big = { ...have, events: many };
  const next = { ...have, now: "2026-11-22T10:01:00.000Z", items: [], events: [event("new", "a", "2026-11-22T10:00:59Z")], delta: { since: have.now, inactive: [] } };
  const merged = mergeWorkDelta(big, next);
  assert.equal(merged.events.length, 2000);
  assert.equal(merged.events[0].id, "new");
});

test("a full read (no delta) simply replaces the snapshot", () => {
  const next = { ...have, now: "2026-11-22T11:00:00.000Z", items: [item("z", 5)] };
  assert.equal(mergeWorkDelta(have, next), next);
});

test("the trimmed Work views drop exactly what compactWorkSnapshot drops", () => {
  const sql = fs.readFileSync("supabase/migrations/20261122170000_work_lite_views.sql", "utf8");
  // the views keep every table column
  for (const col of ["id", "number", "kind", "title", "data", "revision", "archived", "deleted_at", "created_at", "updated_at"])
    assert.match(sql.split("create or replace view public.work_events_lite")[0], new RegExp(`\\b${col}\\b`));
  for (const col of ["id", "item_id", "actor", "actor_id", "type", "body", "created_at", "data"])
    assert.match(sql.split("create or replace view public.work_events_lite")[1], new RegExp(`\\b${col}\\b`));
  assert.match(sql, /revoke all on public\.work_items_lite, public\.work_events_lite from anon, authenticated/);
  // and the client-side compaction they mirror still removes raw and before/after copies
  const compact = compactWorkSnapshot({
    now: "", receipts: [],
    items: [item("a", 1, { data: { source: { raw: { big: 1 }, url: "u" } } })],
    events: [{ ...event("e", "a", ""), data: { before: { data: { status: "Todo", x: 1 } }, after: null, source: { raw: 1, id: "s" } } }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(compact.items[0].data)), { source: { url: "u" } });
  assert.deepEqual(JSON.parse(JSON.stringify(compact.events[0].data)), { before: { data: { status: "Todo" } }, after: null, source: { id: "s" } });
});

test("pages that never draw outlines read every fab_parts column but geometry", () => {
  // Columns from the migrations: create table, then add/drop/rename column, in order.
  const files = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const cols = new Set();
  for (const f of files) {
    const sql = fs.readFileSync(`supabase/migrations/${f}`, "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";")) {
      const create = stmt.match(/create table (?:if not exists )?(?:public\.)?fab_parts\s*\(([\s\S]*)\)\s*$/i);
      if (create) {
        let depth = 0, part = "";
        const parts = [];
        for (const ch of create[1]) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (ch === "," && depth === 0) { parts.push(part); part = ""; } else part += ch;
        }
        parts.push(part);
        for (const p of parts) {
          const name = p.trim().match(/^(\w+)/)?.[1];
          if (name && !/^(constraint|primary|unique|check|foreign)$/i.test(name)) cols.add(name);
        }
      }
      if (!/alter table (?:if exists )?(?:public\.)?fab_parts\b/i.test(stmt)) continue;
      for (const m of stmt.matchAll(/add column (?:if not exists )?(\w+)/gi)) cols.add(m[1]);
      for (const m of stmt.matchAll(/drop column (?:if exists )?(\w+)/gi)) cols.delete(m[1]);
      for (const m of stmt.matchAll(/rename column (\w+) to (\w+)/gi)) { cols.delete(m[1]); cols.add(m[2]); }
    }
  }
  const src = fs.readFileSync("lib/parts-data.ts", "utf8");
  const list = src.match(/PART_COLUMNS_WITHOUT_GEOMETRY =([\s\S]*?);/)[1].match(/"([^"]*)"/g).map((s) => s.slice(1, -1)).join("").split(",");
  cols.delete("geometry");
  assert.deepEqual([...list].sort(), [...cols].sort());
});
