import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateWorkInput,
  filterIssues,
  issueCode,
  progress,
} from "../lib/work.ts";
const team = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const issue = (id, data = {}, props = {}) => ({
  id,
  number: 42,
  kind: "issue",
  title: "Inspect drivetrain",
  data,
  archived: false,
  deleted_at: null,
  revision: 1,
  created_at: "2026-09-30",
  updated_at: "2026-09-30",
  ...props,
});
test("filters compose without including archived or trashed work", () => {
  const items = [
    issue("a", { team, assignee: member, status: "Todo", priority: 2 }),
    issue("b", { team, assignee: member, status: "Done", priority: 2 }),
    issue("c", { team }, { archived: true }),
    issue("d", { team }, { deleted_at: "2026-09-30" }),
  ];
  assert.deepEqual(
    filterIssues(items, {
      team,
      assignee: member,
      status: "Todo",
      priority: "2",
    }).map((i) => i.id),
    ["a"],
  );
  assert.equal(filterIssues(items, { query: "DRIVETRAIN" }).length, 2);
});
test("issue identifiers use the owning team", () => {
  const i = issue("a", { team });
  assert.equal(
    issueCode(i, [{ id: team, kind: "team", data: { identifier: "MECH" } }]),
    "MECH-42",
  );
  assert.equal(issueCode(issue("a"), []), "WB-42");
});
test("status filters match imported capitalization and implicit Backlog", () => {
  const items = [issue("a", { status: "In Progress" }), issue("b", { status: "In progress" }), issue("c")];
  assert.deepEqual(filterIssues(items, { status: "In progress" }).map(i => i.id), ["a", "b"]);
  assert.deepEqual(filterIssues(items, { status: "Backlog" }).map(i => i.id), ["c"]);
});
test("server input validation rejects invalid kinds, properties, and unsafe links", () => {
  for (const [kind, title, data] of [
    ["bad", "a", {}],
    ["issue", "", {}],
    ["issue", "a", { priority: 5 }],
    ["issue", "a", { estimate: -1 }],
    ["issue", "a", { assignee: "bad" }],
    ["issue", "a", { url: "javascript:alert(1)" }],
    ["issue", "a", { due: "2026-02-30" }],
    ["cycle", "a", { start: "2026-10-10", due: "2026-10-01" }],
    ["issue", "a", { recurrence: "weekly" }],
  ])
    assert.throws(() => validateWorkInput(kind, title, data));
});
test("valid changes strip unknown properties and normalize labels", () => {
  const result = validateWorkInput("issue", "  Build the intake  ", {
    labels: [team, team],
    priority: 1,
    admin: true,
    description: "**Review** the drawing.",
  });
  assert.equal(result.title, "Build the intake");
  assert.deepEqual(result.data.labels, [team]);
  assert.equal(result.data.admin, undefined);
});
test("empty progress stays finite and finished work rolls up", () => {
  assert.equal(progress([]), 0);
  assert.equal(
    progress([issue("a", { status: "Done" }), issue("b", { status: "Todo" })]),
    50,
  );
});

test("milestones count only live issues in their project, with quarter credit for started work", async () => {
  const { milestoneProgress } = await import("../lib/work.ts");
  const m = { ...issue("m"), kind: "milestone", data: { project: "p" } };
  const linked = (id, status, extra = {}) => issue(id, { project: "p", milestone: "m", status }, extra);
  const items = [linked("a", "Done"), linked("b", "In Progress"), linked("c", "Todo"), linked("d", "Done", { archived: true }), linked("e", "Done", { deleted_at: "2026-09-30" }), issue("f", { project: "other", milestone: "m", status: "Done" })];
  assert.deepEqual(milestoneProgress(m, items), { total: 3, completed: 1, percent: 42, complete: false });
  assert.deepEqual(milestoneProgress(m, [linked("a", "Done")]), { total: 1, completed: 1, percent: 100, complete: true });
  assert.equal(milestoneProgress(m, []).complete, false);
  assert.equal(milestoneProgress({ ...m, data: { status: "Completed" } }, []).percent, 100);
});

test("compact snapshots preserve visible history and provenance without mutating full exports", async () => {
  const { compactWorkSnapshot } = await import("../lib/work-snapshot.ts");
  const item = issue("a", { source: { system: "linear", identifier: "WB-1", raw: { secretImportField: "large data" } } });
  const event = { id: "e", item_id: "a", body: "Update body", data: { before: { data: { status: "Todo", description: "long description" } }, after: { data: { status: "Done" } }, source: { id: "linear-e", raw: { anything: "large data" } } } };
  const snapshot = { items: [item], events: [event], receipts: [], now: "2026-09-30" };
  const compact = compactWorkSnapshot(snapshot);
  assert.equal(compact.items[0].data.source.raw, undefined);
  assert.equal(compact.items[0].data.source.identifier, "WB-1");
  assert.equal(compact.events[0].body, "Update body");
  assert.deepEqual(compact.events[0].data.before, { data: { status: "Todo" } });
  assert.equal(compact.events[0].data.source.raw, undefined);
  assert.equal(snapshot.items[0].data.source.raw.secretImportField, "large data");
  assert.equal(snapshot.events[0].data.before.data.description, "long description");
});

test("timeline keeps every marker and only drops labels that have no room", async () => {
  const { labelSlots } = await import("../lib/work-timeline.ts");
  const m = (id, due) => ({ ...issue(id), kind: "milestone", data: { due } });
  const min = Date.parse("2026-09-01"), max = Date.parse("2026-10-01");
  const milestones = [m("a","2026-09-02"),m("b","2026-09-03"),m("c","2026-09-03"),m("d","2026-09-20"),m("old","2026-08-20"),m("undated",undefined)];
  const slots = labelSlots(milestones,min,max,1000);
  assert.deepEqual(slots.map(s => s.m.id), ["a","b","c","d"]);
  assert.deepEqual(slots.map(s => s.width > 0), [false,false,true,true]);
  assert.equal(labelSlots(milestones,min,max,6000)[0].width, 170);
});

test("status choices deduplicate imported capitalization while preserving the selected value", async () => {
  const { uniqueStatuses } = await import("../lib/work.ts");
  assert.deepEqual(uniqueStatuses(["In Progress", "Backlog", "In progress", "Done", "done"]), ["In Progress", "Backlog", "Done"]);
});

test("an edit is judged against stored values only for the fields it touches", () => {
  const stored = { start: "2026-10-10", due: "2026-10-01", recurrence: "weekly", estimate: 0.5 };
  // Untouched legacy values don't block an unrelated change.
  assert.deepEqual(validateWorkInput("project", "p", { status: "Done" }, stored).data, { status: "Done" });
  // Touching a date re-checks the pair, and recurrence still needs a due date.
  assert.throws(() => validateWorkInput("project", "p", { due: "2026-09-01" }, { start: "2026-10-10" }));
  assert.throws(() => validateWorkInput("issue", "i", { due: "" }, { recurrence: "weekly", due: "2026-10-01" }));
  assert.throws(() => validateWorkInput("issue", "i", { recurrence: "weekly" }, {}));
});

test("rows saved in this browser win over an older page snapshot, and new rows are appended", async () => {
  const { mergeItems } = await import("../lib/work-store.ts");
  const snapshot = [issue("a", { status: "Todo" }), issue("b", { status: "Todo" }, { revision: 5 })];
  assert.equal(mergeItems(snapshot, new Map()), snapshot);
  const saved = new Map([
    ["a", issue("a", { status: "Done" }, { revision: 2 })],
    // A refresh that already contains a newer row must not be rolled back by an older saved copy.
    ["b", issue("b", { status: "Backlog" }, { revision: 4 })],
    ["c", issue("c", { status: "Todo" })],
  ]);
  assert.deepEqual(mergeItems(snapshot, saved).map((i) => [i.id, i.data.status]), [["a", "Done"], ["b", "Todo"], ["c", "Todo"]]);
});

test("edits still being saved show immediately, in order, and can be undone", async () => {
  const { applyChanges } = await import("../lib/work-store.ts");
  const items = [issue("a", { status: "Todo", priority: 1 }), issue("b")];
  const shown = applyChanges(items, [
    { id: "a", data: { status: "In progress" } },
    { id: "a", title: "Renamed", data: { status: "Done" } },
    { id: "b", deleted: true },
  ], "2026-11-13T00:00:00Z");
  assert.deepEqual([shown[0].title, shown[0].data], ["Renamed", { status: "Done", priority: 1 }]);
  assert.equal(shown[1].deleted_at, "2026-11-13T00:00:00Z");
  assert.equal(items[0].data.status, "Todo");
  const restored = applyChanges(shown, [{ id: "b", deleted: false }, { id: "a", archived: true }], "now");
  assert.equal(restored[1].deleted_at, null);
  assert.equal(restored[0].archived, true);
  assert.equal(applyChanges(items, [{ kind: "issue", title: "New" }], "now"), items);
});

test("a save rejected for a stale revision is re-sent only when the teammate changed other fields", async () => {
  const { canRebase } = await import("../lib/work-store.ts");
  const base = issue("a", { status: "Todo", assignee: member, labels: [team] });
  const reassigned = issue("a", { status: "Todo", assignee: team, labels: [team] }, { revision: 2 });
  assert.equal(canRebase({ id: "a", data: { status: "Done" } }, base, reassigned), true);
  assert.equal(canRebase({ id: "a", data: { assignee: "" } }, base, reassigned), false);
  assert.equal(canRebase({ id: "a", data: { labels: [] } }, base, reassigned), true);
  assert.equal(canRebase({ id: "a", title: "New title" }, base, { ...reassigned, title: "Their title" }), false);
  // Never write onto something a teammate just trashed or archived.
  assert.equal(canRebase({ id: "a", data: { status: "Done" } }, base, { ...reassigned, deleted_at: "2026-11-13" }), false);
  assert.equal(canRebase({ id: "a", data: { status: "Done" } }, base, { ...reassigned, archived: true }), false);
  assert.equal(canRebase({ id: "a", data: { status: "Done" } }, undefined, reassigned), false);
});

test("an edit form sends only the properties that changed", async () => {
  const { changedData } = await import("../lib/work-store.ts");
  const before = { status: "Todo", labels: [team], description: "Old", due: "2026-11-20" };
  assert.deepEqual(changedData({ ...before, description: "New", due: "" }, before), { description: "New", due: "" });
  assert.deepEqual(changedData({ ...before, labels: [team] }, before), {});
});

test("issue identifiers resolve the team from an id lookup as well as a list", () => {
  const i = issue("a", { team });
  assert.equal(issueCode(i, new Map([[team, { id: team, kind: "team", data: { identifier: "MECH" } }]])), "MECH-42");
  assert.equal(issueCode(i, new Map()), "WB-42");
});

test("saves go to the server one at a time, each on the newest revision", async () => {
  const { createSaveQueue } = await import("../lib/work-store.ts");
  const server = new Map([["a", issue("a", { status: "Todo", priority: 0 })]]);
  const sent = [];
  let active = 0;
  const save = createSaveQueue({
    snapshot: () => issue("a", { status: "Todo", priority: 0 }),
    onRows: () => {},
    send: async (changes) => {
      assert.equal(++active, 1, "requests must not overlap");
      await new Promise((r) => setTimeout(r, 5));
      sent.push(changes.map((c) => c.revision));
      const rows = changes.map((c) => {
        const row = server.get(c.id);
        if (c.revision !== row.revision) throw new Error("stale revision reached the server");
        const next = { ...row, data: { ...row.data, ...c.data }, revision: row.revision + 1 };
        server.set(c.id, next);
        return next;
      });
      active--;
      return { ok: true, items: rows };
    },
  });
  // Three quick edits to one task, as when someone sets status, priority and assignee in a row.
  const results = await Promise.all([
    save([{ id: "a", data: { status: "In progress" } }]),
    save([{ id: "a", data: { priority: 1 } }]),
    save([{ id: "a", data: { assignee: member } }]),
  ]);
  assert.deepEqual(results.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(sent, [[1], [2], [3]]);
  assert.deepEqual(server.get("a").data, { status: "In progress", priority: 1, assignee: member });
});

test("a teammate's simultaneous edit is merged when fields differ and reported when they collide", async () => {
  const { createSaveQueue } = await import("../lib/work-store.ts");
  const mine = issue("a", { status: "Todo", assignee: member });
  let theirs = issue("a", { status: "Todo", assignee: team }, { revision: 2 });
  let shown = new Map();
  const attempts = [];
  const save = createSaveQueue({
    snapshot: () => mine,
    onRows: (rows) => { shown = new Map(rows); },
    send: async ([c]) => {
      attempts.push(c.revision);
      if (c.revision !== theirs.revision) return { ok: false, error: "A teammate changed this.", current: [theirs] };
      theirs = { ...theirs, data: { ...theirs.data, ...c.data }, revision: theirs.revision + 1 };
      return { ok: true, items: [theirs] };
    },
  });
  // They reassigned it, I marked it done: both stick.
  assert.equal((await save([{ id: "a", data: { status: "Done" } }])).ok, true);
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(shown.get("a").data, { status: "Done", assignee: team });

  // We both changed the assignee: mine is refused, and theirs is what shows.
  attempts.length = 0;
  theirs = { ...theirs, data: { ...theirs.data, assignee: member }, revision: theirs.revision + 1 };
  const refused = await save([{ id: "a", data: { assignee: "" } }]);
  assert.deepEqual(refused, { ok: false, error: "A teammate changed this." });
  assert.deepEqual(attempts, [3]);
  assert.equal(shown.get("a").data.assignee, member);

  // A dropped connection fails that save without breaking the next one.
  const offline = createSaveQueue({ snapshot: () => mine, onRows: () => {}, send: async () => { throw new Error("offline"); } });
  assert.match((await offline([{ id: "a", data: { status: "Done" } }])).error, /reach the server/);
  assert.equal((await offline([{ id: "a", data: { status: "Done" } }])).ok, false);
});
