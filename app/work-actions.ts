"use server";
import { revalidatePath } from "next/cache";
import { requireWorkUser, type WorkRole } from "@/lib/work-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { compactWorkItem } from "@/lib/work-snapshot";
import {
  validateWorkInput,
  type WorkData,
  type WorkItem,
  type WorkKind,
} from "@/lib/work";

type Change = {
  id?: string;
  revision?: number;
  kind?: WorkKind;
  title?: string;
  data?: WorkData;
  archived?: boolean;
  deleted?: boolean;
};
async function guard(write = true) {
  return requireWorkUser(write);
}
function message(e: unknown) {
  return e && typeof e === "object" && "message" in e
    ? String(e.message)
    : "Couldn't save. Please try again.";
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ref = { id: string; kind: WorkKind };
/** Reads rows by id in a few parallel requests, however many are asked for. */
async function rowsById<T extends { id: string }>(ids: string[], columns: string) {
  const unique = Array.from(new Set(ids));
  const chunks: string[][] = [];
  for (let n = 0; n < unique.length; n += 100) chunks.push(unique.slice(n, n + 100));
  const results = await Promise.all(
    chunks.map((chunk) => supabaseAdmin().from("work_items").select(columns).in("id", chunk)),
  );
  const rows = new Map<string, T>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of (data ?? []) as unknown as T[]) rows.set(row.id, row);
  }
  return rows;
}
/** Every other item a change points at, with the kind it has to be. */
function references(data: WorkData, kind: WorkKind): Ref[] {
  const expected: Record<string, WorkKind> = {
    team: "team",
    assignee: "member",
    project: "project",
    initiative: "initiative",
    cycle: "cycle",
    parent: "issue",
    milestone: "milestone",
    customer: "customer",
    release: "release",
    parentInitiative: "initiative",
    parentTeam: "team",
  };
  const refs: Ref[] = Object.entries(expected).flatMap(([k, kind]) =>
    data[k as keyof WorkData]
      ? [{ id: String(data[k as keyof WorkData]), kind }]
      : [],
  );
  refs.push(
    ...(data.labels ?? []).map((id) => ({ id, kind: "label" as const })),
    ...(data.subscribers ?? []).map((id) => ({ id, kind: "member" as const })),
    ...(data.favorites ?? []).map((id) => ({ id, kind: "member" as const })),
    ...(data.relations ?? []).map((r) => ({
      id: r.id,
      kind: kind === "project" ? ("project" as const) : ("issue" as const),
    })),
  );
  return refs;
}
async function checkLoops(data: WorkData, id: string, kind: WorkKind) {
  if (data.parent === id || data.relations?.some((r) => r.id === id))
    throw new Error("A task cannot reference itself.");
  const parentKey =
    kind === "initiative"
      ? "parentInitiative"
      : kind === "team"
        ? "parentTeam"
        : "parent";
  if (data[parentKey]) {
    const seen = new Set([id]);
    let parent: string | undefined = data[parentKey];
    while (parent) {
      if (seen.has(parent))
        throw new Error("Parent relationship would create a loop.");
      seen.add(parent);
      const result: { data: { data: WorkData } | null } = await supabaseAdmin()
        .from("work_items")
        .select("data")
        .eq("id", parent)
        .single();
      parent = result.data?.data[parentKey];
    }
  }
}
export async function mutateWork(
  changes: Change[],
): Promise<
  | { ok: true; items: WorkItem[] }
  // `current` holds the newer rows when a teammate saved first, so the browser can catch up without reloading.
  | { ok: false; error: string; current?: WorkItem[] }
> {
  try {
    const user = await guard();
    if (!Array.isArray(changes) || !changes.length || changes.length > 200)
      throw new Error("Select between 1 and 200 items.");
    for (const c of changes) {
      if (!c || typeof c !== "object") throw new Error("Invalid change.");
      if (c.id !== undefined && (typeof c.id !== "string" || !UUID.test(c.id)))
        throw new Error("Item no longer exists.");
    }
    const stored = await rowsById<WorkItem>(
      changes.flatMap((c) => (c.id ? [c.id] : [])),
      "*",
    );
    const normalized: Change[] = [];
    const refs: Ref[] = [];
    const loops: { data: WorkData; id: string; kind: WorkKind }[] = [];
    const stale: WorkItem[] = [];
    for (const c of changes) {
      if (c.id) {
        const before = stored.get(c.id);
        if (!before) throw new Error("Item no longer exists.");
        if (["team", "member"].includes(before.kind) && user.role !== "admin")
          throw new Error("Only admins can manage teams and members.");
        if (before.kind === "member" && (c.deleted || c.archived))
          throw new Error(
            "Disable account access in Settings → People instead of deleting profiles.",
          );
        if (!Number.isInteger(c.revision) || c.revision !== before.revision) {
          stale.push(compactWorkItem(before));
          continue;
        }
        if (
          (c.archived !== undefined && typeof c.archived !== "boolean") ||
          (c.deleted !== undefined && typeof c.deleted !== "boolean")
        )
          throw new Error("Invalid archive action.");
        // Validate only what this change sets, so stored values from imports or
        // since-trashed references can't block an unrelated edit.
        const changed = Object.fromEntries(
          Object.entries(c.data ?? {}).filter(
            ([k, v]) =>
              JSON.stringify(v) !==
              JSON.stringify((before.data as Record<string, unknown>)[k]),
          ),
        );
        const valid = validateWorkInput(
          before.kind,
          c.title ?? before.title,
          changed,
          before.data,
        );
        refs.push(...references(valid.data, before.kind));
        loops.push({ data: valid.data, id: c.id, kind: before.kind });
        // The database resets a recurring issue's next date unless due/recurrence
        // are restated, so carry the stored values along.
        const keep: WorkData = {};
        if (before.data.due !== undefined) keep.due = before.data.due;
        if (before.data.recurrence !== undefined)
          keep.recurrence = before.data.recurrence;
        normalized.push({
          id: c.id,
          revision: c.revision,
          title: valid.title,
          data: { ...keep, ...valid.data },
          ...(c.archived !== undefined ? { archived: c.archived } : {}),
          ...(c.deleted !== undefined ? { deleted: c.deleted } : {}),
        });
      } else {
        const valid = validateWorkInput(c.kind, c.title, c.data ?? {});
        if (["team", "member"].includes(valid.kind) && user.role !== "admin")
          throw new Error("Only admins can manage teams and members.");
        refs.push(...references(valid.data, valid.kind));
        normalized.push(valid);
      }
    }
    if (stale.length)
      return {
        ok: false,
        error: "A teammate changed this at the same moment. The latest version is showing now, so try again.",
        current: stale,
      };
    if (refs.length) {
      const found = await rowsById<{ id: string; kind: WorkKind; deleted_at: string | null }>(
        refs.map((r) => r.id),
        "id,kind,deleted_at",
      );
      for (const r of refs) {
        const row = found.get(r.id);
        if (!row || row.kind !== r.kind || row.deleted_at)
          throw new Error(
            "A selected item is no longer available. Reload and select it again.",
          );
      }
    }
    for (const l of loops) await checkLoops(l.data, l.id, l.kind);
    const { data, error } = await supabaseAdmin().rpc(
      "mutate_work_authenticated",
      {
        changes: normalized,
        auth_id: user.userId,
      },
    );
    if (error) throw error;
    // No revalidatePath: the saved rows go straight back to the browser, and the database's
    // "changed" broadcast has everyone re-read history (see components/work/work-provider.tsx).
    return { ok: true, items: (data as WorkItem[]).map(compactWorkItem) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
export async function addWorkComment(
  id: string,
  body: string,
  type = "comment",
) {
  try {
    const user = await guard();
    if (
      typeof body !== "string" ||
      !body.trim() ||
      body.length > 20000 ||
      !["comment", "update", "reaction"].includes(type)
    )
      throw new Error("Enter a comment of 1–20,000 characters.");
    const { data: item } = await supabaseAdmin()
      .from("work_items")
      .select("id,title")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (!item) throw new Error("Item is no longer available.");
    const { error } = await supabaseAdmin().from("work_events").insert({
      item_id: id,
      actor: user.name,
      actor_id: user.memberId,
      body: body.trim(),
      type,
    });
    if (error) throw error;
    if (type === "update")
      await postDiscordUpdate(String(item.title ?? ""), user.name, body.trim());
    revalidatePath("/work", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
async function ownUpdate(eventId: string) {
  const user = await guard();
  const { data: event } = await supabaseAdmin()
    .from("work_events")
    .select("id,actor_id,type")
    .eq("id", eventId)
    .single();
  if (!event || event.type !== "update")
    throw new Error("Update is no longer available.");
  if (user.role !== "admin" && event.actor_id !== user.memberId)
    throw new Error("Only the author or an admin can change this update.");
  return event;
}
export async function editWorkUpdate(eventId: string, body: string) {
  try {
    if (typeof body !== "string" || !body.trim() || body.length > 20000)
      throw new Error("Enter an update of 1–20,000 characters.");
    await ownUpdate(eventId);
    const { error } = await supabaseAdmin()
      .from("work_events")
      .update({ body: body.trim() })
      .eq("id", eventId);
    if (error) throw error;
    revalidatePath("/work", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
export async function deleteWorkUpdate(eventId: string) {
  try {
    await ownUpdate(eventId);
    const { error } = await supabaseAdmin()
      .from("work_events")
      .delete()
      .eq("id", eventId);
    if (error) throw error;
    revalidatePath("/work", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
// Best-effort: mirrors project updates to Discord; never fails the save.
async function postDiscordUpdate(title: string, actor: string, body: string) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "3256Tools",
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: `Project update: ${title}`.slice(0, 256),
            description: body.slice(0, 4000),
            footer: { text: actor },
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}
export async function markWorkRead(
  eventIds: string[],
  snoozedUntil: string | null = null,
) {
  try {
    const user = await guard(false);
    if (!Array.isArray(eventIds) || eventIds.length > 2000)
      throw new Error("Invalid notification selection.");
    if (
      snoozedUntil &&
      (!Number.isFinite(Date.parse(snoozedUntil)) ||
        Date.parse(snoozedUntil) <= Date.now())
    )
      throw new Error("Choose a future snooze time.");
    if (eventIds.length) {
      const { error } = await supabaseAdmin()
        .from("work_receipts")
        .upsert(
          eventIds.map((event_id) => ({
            event_id,
            member_id: user.memberId,
            snoozed_until: snoozedUntil,
          })),
        );
      if (error) throw error;
    }
    revalidatePath("/work", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function setWorkAccess(
  email: string,
  role: WorkRole,
  disabled: boolean,
) {
  try {
    const user = await requireWorkUser(true, true);
    if (
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 320 ||
      !["admin", "member", "viewer"].includes(role) ||
      typeof disabled !== "boolean"
    )
      throw new Error("Enter a valid email and role.");
    const { error } = await supabaseAdmin().rpc("set_work_access", {
      actor_id: user.userId,
      account_email: email.trim().toLowerCase(),
      account_role: role,
      account_disabled: disabled,
    });
    if (error) throw error;
    revalidatePath("/work", "layout");
    revalidatePath("/admin");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
export async function removeWorkAccess(email: string) {
  try {
    const user = await requireWorkUser(true, true);
    if (typeof email !== "string" || !email.trim())
      throw new Error("Choose someone to remove.");
    const target = email.trim().toLowerCase();
    if (target === user.email.toLowerCase())
      throw new Error("You can't remove your own access.");
    const db = supabaseAdmin();
    const { data: account, error: findError } = await db
      .from("work_access")
      .select("role,disabled")
      .eq("email", target)
      .maybeSingle();
    if (findError) throw findError;
    if (!account) throw new Error("That person no longer has access.");
    if (account.role === "admin" && !account.disabled) {
      const { count, error: countError } = await db
        .from("work_access")
        .select("email", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("disabled", false);
      if (countError) throw countError;
      if ((count ?? 0) <= 1) throw new Error("Keep at least one active admin");
    }
    const { error } = await db.from("work_access").delete().eq("email", target);
    if (error) throw error;
    revalidatePath("/work", "layout");
    revalidatePath("/admin");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
