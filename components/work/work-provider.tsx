"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { PitProblem, ProblemStatus, RobotIssueInput } from "@/lib/pit";
import type { WorkItem, WorkSnapshot } from "@/lib/work";
import { applyChanges, createSaveQueue, mergeItems, type SaveReply, type SaveResult, type WorkChange } from "@/lib/work-store";
import type { WorkUser, WorkAccess } from "@/lib/work-auth";

type WorkContext = {
  snapshot: WorkSnapshot;
  user: WorkUser;
  access: WorkAccess[];
  /** The snapshot's items with this browser's saved and still-saving edits applied. */
  items: WorkItem[];
  /**
   * Saves changes one request at a time, always against the newest revision, so quick edits never collide.
   * With `optimistic` the edit shows at once and is undone if the server refuses it.
   */
  save: (changes: WorkChange[], optimistic?: boolean) => Promise<SaveResult>;
  saving: boolean;
  /** Re-reads the workspace in the background. */
  refresh: () => void;
  /** Robot issues (the shared pit problem log) with this browser's saves applied. */
  problems: PitProblem[];
  /** Reports a robot issue, at the active competition when `atEvent`. */
  reportProblem: (issue: RobotIssueInput & { atEvent?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  /** Shows the new status at once; puts it back if the server refuses. */
  setProblemStatus: (problem: PitProblem, status: ProblemStatus) => Promise<{ ok: boolean; error?: string }>;
};

async function sendProblem(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; problem?: PitProblem }> {
  try {
    const response = await fetch("/api/work/robot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) return { ok: false, error: "You've been signed out. Reload the page and sign in again." };
    return await response.json();
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
const Context = createContext<WorkContext | null>(null);

async function sendChanges(changes: WorkChange[]): Promise<SaveReply> {
  const response = await fetch("/api/work/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  if (response.status === 401) return { ok: false, error: "You've been signed out. Reload the page and sign in again." };
  return response.json();
}

/**
 * Holds the workspace for every Work page. The server renders the first snapshot; after that this
 * re-reads it as JSON and saves with plain requests, so neither ever makes a page wait.
 */
export function WorkProvider({ children, snapshot: rendered, user, access }: Pick<WorkContext, "snapshot" | "user" | "access"> & { children: ReactNode }) {
  const [fetched, setFetched] = useState<WorkSnapshot | null>(null);
  const snapshot = fetched && fetched.now > rendered.now ? fetched : rendered;
  const [saved, setSaved] = useState<Map<string, WorkItem>>(() => new Map());
  const [queued, setQueued] = useState<{ key: number; changes: WorkChange[] }[]>([]);
  const [inFlight, setInFlight] = useState(0);
  const base = useMemo(() => mergeItems(snapshot.items, saved), [snapshot.items, saved]);
  const items = useMemo(() => applyChanges(base, queued.flatMap((q) => q.changes), snapshot.now), [base, queued, snapshot.now]);

  const reading = useRef({ busy: false, again: false });
  const refresh = useCallback(async () => {
    // One read at a time; a request made meanwhile runs once more afterwards so nothing is missed.
    const state = reading.current;
    if (state.busy) {
      state.again = true;
      return;
    }
    state.busy = true;
    do {
      state.again = false;
      try {
        const response = await fetch("/api/work/snapshot", { cache: "no-store" });
        const next: WorkSnapshot | null = response.ok ? await response.json() : null;
        // A failed read keeps what is on screen rather than blanking the workspace.
        if (next && !next.error) setFetched((have) => (have && have.now >= next.now ? have : next));
      } catch {
        // Offline: the next focus, ping or timer tries again.
      }
    } while (state.again);
    state.busy = false;
  }, []);
  useEffect(() => {
    // Stay in step with teammates: re-read on the database's "changed" ping (Work tables only),
    // when the tab comes back, and on a slow fallback timer.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (navigator.onLine) refresh(); }, 250);
    };
    const sb = supabaseBrowser();
    const channel = sb
      ?.channel("board")
      .on("broadcast", { event: "changed" }, (message) => {
        const table = (message.payload as { table?: string } | undefined)?.table;
        if (!table || table.startsWith("work_") || table === "pit_problems") soon();
      })
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") soon(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", soon);
    const interval = setInterval(soon, 60_000);
    return () => {
      if (channel) sb?.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", soon);
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    // A page restored from the browser's back/forward cache can carry an old snapshot.
    if (Date.now() - Date.parse(rendered.now) <= 30_000) return;
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, [rendered.now, refresh]);

  // The queue outlives renders, so it reads the latest snapshot through a ref.
  const baseRef = useRef(base);
  useEffect(() => { baseRef.current = base; }, [base]);
  const queue = useRef<ReturnType<typeof createSaveQueue> | null>(null);
  const nextKey = useRef(0);

  const save = useCallback(async (changes: WorkChange[], optimistic = false) => {
    const key = ++nextKey.current;
    if (optimistic) setQueued((q) => [...q, { key, changes }]);
    setInFlight((n) => n + 1);
    queue.current ??= createSaveQueue({
      send: sendChanges,
      snapshot: (id) => baseRef.current.find((i) => i.id === id),
      onRows: (rows) => setSaved(new Map(rows)),
    });
    const result = await queue.current(changes);
    // After a refusal, re-read everything in case the server is ahead of what this browser shows.
    if (!result.ok) refresh();
    if (optimistic) setQueued((q) => q.filter((x) => x.key !== key));
    setInFlight((n) => n - 1);
    return result;
  }, [refresh]);

  // Saved robot issues show until the next snapshot, which already includes them.
  const [problemEdits, setProblemEdits] = useState<{ at: string; rows: Map<string, PitProblem> }>({ at: "", rows: new Map() });
  const problems = useMemo(() => {
    const base = snapshot.problems ?? [];
    if (problemEdits.at !== snapshot.now) return base;
    const known = new Set(base.map((p) => p.id));
    const added = [...problemEdits.rows.values()].filter((p) => !known.has(p.id));
    return [...added, ...base.map((p) => problemEdits.rows.get(p.id) ?? p)];
  }, [snapshot, problemEdits]);
  const showProblem = useCallback((problem: PitProblem) => {
    setProblemEdits((have) => ({
      at: snapshot.now,
      rows: new Map([...(have.at === snapshot.now ? have.rows : []), [problem.id, problem]]),
    }));
  }, [snapshot.now]);
  const reportProblem = useCallback(async (issue: RobotIssueInput & { atEvent?: boolean }) => {
    const result = await sendProblem({ action: "report", ...issue });
    if (result.ok && result.problem) showProblem(result.problem);
    return result;
  }, [showProblem]);
  const setProblemStatus = useCallback(async (problem: PitProblem, status: ProblemStatus) => {
    showProblem({ ...problem, status });
    const result = await sendProblem({ action: "status", id: problem.id, status });
    showProblem(result.ok && result.problem ? result.problem : problem);
    return result;
  }, [showProblem]);

  const value = useMemo(
    () => ({ snapshot, user, access, items, save, saving: inFlight > 0, refresh, problems, reportProblem, setProblemStatus }),
    [snapshot, user, access, items, save, inFlight, refresh, problems, reportProblem, setProblemStatus],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWork() {
  const value = useContext(Context);
  if (!value) throw new Error("Work requires its authenticated workspace provider.");
  return value;
}
