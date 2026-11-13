import "server-only";
import { supabaseAdmin } from "./supabase";
import type { PitCheck, PitEvent, PitItem, PitProblem, PitRun } from "./pit";

export async function getPitEvents(): Promise<PitEvent[]> {
  const { data, error } = await supabaseAdmin().from("pit_events").select("*").order("starts_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PitEvent[];
}

/** Every check item, archived included (old runs still point at them). */
export async function getPitItems(): Promise<PitItem[]> {
  const { data, error } = await supabaseAdmin().from("pit_items").select("*").order("sort").order("created_at");
  if (error) throw error;
  return (data ?? []) as PitItem[];
}

export async function getPitRuns(f: { eventId?: string; limit?: number } = {}): Promise<PitRun[]> {
  let q = supabaseAdmin().from("pit_runs").select("*").order("started_at", { ascending: false }).limit(f.limit ?? 1000);
  if (f.eventId) q = q.eq("event_id", f.eventId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PitRun[];
}

export async function getPitRun(id: string): Promise<PitRun | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabaseAdmin().from("pit_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as PitRun) ?? null;
}

/** Checks for the given runs (all runs when omitted). */
export async function getPitChecks(runIds?: string[]): Promise<PitCheck[]> {
  if (runIds && runIds.length === 0) return [];
  const out: PitCheck[] = [];
  // Page through: a season of runs is a few thousand rows, past PostgREST's default cap.
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin().from("pit_checks").select("*").order("checked_at").range(from, from + 999);
    if (runIds) q = q.in("run_id", runIds);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as PitCheck[]));
    if (!data || data.length < 1000) return out;
  }
}

export async function getPitProblems(f: { eventId?: string } = {}): Promise<PitProblem[]> {
  let q = supabaseAdmin().from("pit_problems").select("*").order("occurred_at", { ascending: false }).limit(2000);
  if (f.eventId) q = q.eq("event_id", f.eventId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PitProblem[];
}
