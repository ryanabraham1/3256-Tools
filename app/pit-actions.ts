"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorkUser } from "@/lib/work-auth";
import { isPhase, PROBLEM_STATUSES, runItems, SEVERITIES, type CheckStatus, type PitItem, type PitRun, type ProblemStatus, type Severity } from "@/lib/pit";

export type PitResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

/** Wrap an action body: auth (as a writer), error → message, cache refresh. */
async function run<T>(fn: (who: string) => Promise<T>): Promise<PitResult<T>> {
  try {
    const user = await requireWorkUser(true);
    const data = await fn(user.name);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
    return { ok: false, error: msg };
  }
}

function str(fd: FormData, k: string, max = 2000): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function id(fd: FormData, k: string): string | null {
  const v = str(fd, k);
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
function must<T>(v: T | null | undefined, msg: string): T {
  if (v === null || v === undefined || v === "") throw new Error(msg);
  return v;
}
async function ok<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  return data as NonNullable<T>;
}

async function activeEventId(): Promise<string | null> {
  const { data } = await supabaseAdmin().from("pit_events").select("id").eq("active", true).maybeSingle();
  return (data?.id as string) ?? null;
}

// ── Events ──

export async function savePitEvent(fd: FormData) {
  return run(async () => {
    const eventId = id(fd, "id");
    const row = {
      name: must(str(fd, "name", 120), "Name the competition"),
      starts_on: str(fd, "starts_on") || null,
      ends_on: str(fd, "ends_on") || null,
    };
    if (eventId) await ok(supabaseAdmin().from("pit_events").update(row).eq("id", eventId));
    else {
      const created = await ok(supabaseAdmin().from("pit_events").insert(row).select("id").single());
      // A new competition is usually the one about to start.
      if (fd.get("activate") === "on") await activate(created.id as string);
    }
  });
}

async function activate(eventId: string | null) {
  await ok(supabaseAdmin().from("pit_events").update({ active: false }).eq("active", true));
  if (eventId) await ok(supabaseAdmin().from("pit_events").update({ active: true }).eq("id", eventId));
}

export async function setActivePitEvent(fd: FormData) {
  return run(async () => activate(id(fd, "id")));
}

export async function deletePitEvent(fd: FormData) {
  return run(async () => {
    await ok(supabaseAdmin().from("pit_events").delete().eq("id", must(id(fd, "id"), "No competition")));
  });
}

// ── Checklist items ──

export async function savePitItem(fd: FormData) {
  return run(async () => {
    const itemId = id(fd, "id");
    const phase = str(fd, "phase");
    if (!isPhase(phase)) throw new Error("Pick when this check happens");
    const row = {
      phase,
      section: str(fd, "section", 60),
      title: must(str(fd, "title", 200), "Say what to check"),
      how: str(fd, "how"),
      critical: fd.get("critical") === "on",
    };
    if (itemId) await ok(supabaseAdmin().from("pit_items").update(row).eq("id", itemId));
    else {
      const last = await ok(supabaseAdmin().from("pit_items").select("sort").eq("phase", phase).order("sort", { ascending: false }).limit(1));
      const created = await ok(
        supabaseAdmin().from("pit_items").insert({ ...row, sort: ((last?.[0]?.sort as number) ?? 0) + 10 }).select("id").single(),
      );
      // "Add a check" from a problem the checklist didn't cover: link it.
      const problemId = id(fd, "problem_id");
      if (problemId) await ok(supabaseAdmin().from("pit_problems").update({ item_id: created.id }).eq("id", problemId));
    }
  });
}

export async function archivePitItem(fd: FormData) {
  return run(async () => {
    const archived = fd.get("archived") !== "false";
    await ok(
      supabaseAdmin()
        .from("pit_items")
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("id", must(id(fd, "id"), "No item")),
    );
  });
}

/** Swap an item with its neighbour in the same phase. */
export async function movePitItem(fd: FormData) {
  return run(async () => {
    const itemId = must(id(fd, "id"), "No item");
    const dir = str(fd, "dir") === "up" ? -1 : 1;
    const item = (await ok(supabaseAdmin().from("pit_items").select("*").eq("id", itemId).single())) as PitItem;
    const peers = ((await ok(
      supabaseAdmin().from("pit_items").select("*").eq("phase", item.phase).is("archived_at", null).order("sort").order("created_at"),
    )) ?? []) as PitItem[];
    const i = peers.findIndex((p) => p.id === itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= peers.length) return;
    [peers[i], peers[j]] = [peers[j], peers[i]];
    // Renumber the whole phase so equal sort values can't stall a move.
    await Promise.all(peers.map((p, n) => ok(supabaseAdmin().from("pit_items").update({ sort: (n + 1) * 10 }).eq("id", p.id))));
  });
}

// ── Runs ──

export async function startPitRun(fd: FormData) {
  return run(async (who) => {
    const phase = str(fd, "phase");
    if (!isPhase(phase)) throw new Error("Pick a checklist");
    const created = await ok(
      supabaseAdmin()
        .from("pit_runs")
        .insert({ phase, label: str(fd, "label", 40), event_id: await activeEventId(), started_by: who })
        .select("id")
        .single(),
    );
    return created.id as string;
  });
}

export async function setPitCheck(fd: FormData) {
  return run(async (who) => {
    const runId = must(id(fd, "run_id"), "No run");
    const itemId = must(id(fd, "item_id"), "No item");
    const status = str(fd, "status");
    if (status === "clear") {
      await ok(supabaseAdmin().from("pit_checks").delete().eq("run_id", runId).eq("item_id", itemId));
      return;
    }
    if (!(["ok", "issue", "na"] as string[]).includes(status)) throw new Error("Unknown check result");
    await ok(
      supabaseAdmin()
        .from("pit_checks")
        .upsert(
          { run_id: runId, item_id: itemId, status: status as CheckStatus, note: str(fd, "note"), checked_by: who, checked_at: new Date().toISOString() },
          { onConflict: "run_id,item_id" },
        ),
    );
  });
}

/** Finish a run: everything nobody checked is recorded as missed. */
export async function finishPitRun(fd: FormData) {
  return run(async (who) => {
    const runId = must(id(fd, "run_id"), "No run");
    const r = (await ok(supabaseAdmin().from("pit_runs").select("*").eq("id", runId).single())) as PitRun;
    if (r.completed_at) return;
    const [items, checks] = await Promise.all([
      ok(supabaseAdmin().from("pit_items").select("*").eq("phase", r.phase)),
      ok(supabaseAdmin().from("pit_checks").select("item_id").eq("run_id", runId)),
    ]);
    const done = new Set((checks ?? []).map((c) => c.item_id as string));
    const now = new Date().toISOString();
    const missed = runItems(r, (items ?? []) as PitItem[]).filter((i) => !done.has(i.id));
    if (missed.length)
      await ok(
        supabaseAdmin()
          .from("pit_checks")
          .upsert(missed.map((i) => ({ run_id: runId, item_id: i.id, status: "missed", checked_at: now })), { onConflict: "run_id,item_id", ignoreDuplicates: true }),
      );
    await ok(supabaseAdmin().from("pit_runs").update({ completed_at: now, completed_by: who }).eq("id", runId));
  });
}

export async function reopenPitRun(fd: FormData) {
  return run(async () => {
    const runId = must(id(fd, "run_id"), "No run");
    // Missed marks were only a placeholder for "nobody checked".
    await ok(supabaseAdmin().from("pit_checks").delete().eq("run_id", runId).eq("status", "missed"));
    await ok(supabaseAdmin().from("pit_runs").update({ completed_at: null, completed_by: "" }).eq("id", runId));
  });
}

export async function deletePitRun(fd: FormData) {
  return run(async () => {
    await ok(supabaseAdmin().from("pit_runs").delete().eq("id", must(id(fd, "run_id"), "No run")));
  });
}

// ── Problems ──

export async function savePitProblem(fd: FormData) {
  return run(async (who) => {
    const problemId = id(fd, "id");
    const severity = str(fd, "severity") || "minor";
    if (!(SEVERITIES as readonly string[]).includes(severity)) throw new Error("Pick a severity");
    const status = str(fd, "status") || "open";
    if (!(PROBLEM_STATUSES as readonly string[]).includes(status)) throw new Error("Pick a status");
    const row = {
      title: must(str(fd, "title", 200), "Say what went wrong"),
      details: str(fd, "details"),
      area: str(fd, "area", 60),
      match_label: str(fd, "match_label", 40),
      severity: severity as Severity,
      status: status as ProblemStatus,
      fix: str(fd, "fix"),
      follow_up: str(fd, "follow_up"),
      item_id: id(fd, "item_id"),
    };
    if (problemId) {
      const prev = await ok(supabaseAdmin().from("pit_problems").select("status,resolved_at").eq("id", problemId).single());
      const resolved_at = row.status === "open" ? null : prev.status === "open" ? new Date().toISOString() : prev.resolved_at;
      await ok(supabaseAdmin().from("pit_problems").update({ ...row, resolved_at }).eq("id", problemId));
      return;
    }
    const runId = id(fd, "run_id");
    await ok(
      supabaseAdmin().from("pit_problems").insert({
        ...row,
        run_id: runId,
        event_id: await activeEventId(),
        reported_by: who,
        resolved_at: row.status === "open" ? null : new Date().toISOString(),
      }),
    );
    // Logged from a check: that check found a problem.
    if (runId && row.item_id)
      await ok(
        supabaseAdmin()
          .from("pit_checks")
          .upsert(
            { run_id: runId, item_id: row.item_id, status: "issue", note: row.title, checked_by: who, checked_at: new Date().toISOString() },
            { onConflict: "run_id,item_id" },
          ),
      );
  });
}

export async function setPitProblemStatus(fd: FormData) {
  return run(async () => {
    const status = str(fd, "status");
    if (!(PROBLEM_STATUSES as readonly string[]).includes(status)) throw new Error("Pick a status");
    await ok(
      supabaseAdmin()
        .from("pit_problems")
        .update({ status, resolved_at: status === "open" ? null : new Date().toISOString() })
        .eq("id", must(id(fd, "id"), "No problem")),
    );
  });
}

export async function deletePitProblem(fd: FormData) {
  return run(async () => {
    await ok(supabaseAdmin().from("pit_problems").delete().eq("id", must(id(fd, "id"), "No problem")));
  });
}

// ── Import ──

/** Add (or replace the checklist with) items parsed from a doc; the client sends the reviewed rows as JSON. */
export async function importPitItems(fd: FormData) {
  return run(async () => {
    let rows: unknown;
    try {
      rows = JSON.parse(str(fd, "rows", 500_000));
    } catch {
      throw new Error("Nothing to import");
    }
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Nothing to import");
    if (rows.length > 500) throw new Error("That's more than 500 checks — split the doc up");
    const clean = rows.map((r, n) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const phase = String(o.phase ?? "");
      const title = String(o.title ?? "").trim().slice(0, 200);
      if (!isPhase(phase) || !title) throw new Error(`Row ${n + 1} needs a check and a phase`);
      return {
        phase,
        title,
        section: String(o.section ?? "").trim().slice(0, 60),
        how: String(o.how ?? "").trim().slice(0, 2000),
        critical: o.critical === true,
        sort: (n + 1) * 10,
      };
    });
    if (fd.get("replace") === "on")
      await ok(supabaseAdmin().from("pit_items").update({ archived_at: new Date().toISOString() }).is("archived_at", null));
    else {
      // Append after what's there.
      const last = await ok(supabaseAdmin().from("pit_items").select("sort").order("sort", { ascending: false }).limit(1));
      const base = (last?.[0]?.sort as number) ?? 0;
      for (const c of clean) c.sort += base;
    }
    await ok(supabaseAdmin().from("pit_items").insert(clean));
    return clean.length;
  });
}

/** Plain text of a Google Doc shared as "Anyone with the link". */
export async function fetchGoogleDoc(fd: FormData): Promise<PitResult<string>> {
  try {
    await requireWorkUser(true);
    const m = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(str(fd, "url"));
    if (!m) return { ok: false, error: "That isn't a Google Docs link" };
    const res = await fetch(`https://docs.google.com/document/d/${m[1]}/export?format=txt`, { redirect: "follow", cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("text/plain"))
      return {
        ok: false,
        error: "Couldn't open that doc. Share it as “Anyone with the link can view”, or download it (File → Download → .docx or PDF) and upload the file.",
      };
    return { ok: true, data: (await res.text()).slice(0, 400_000) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
