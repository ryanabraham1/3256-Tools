"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { PitProblem, ProblemStatus, RobotIssueInput } from "@/lib/pit";
import type { WorkItem, WorkSnapshot } from "@/lib/work";
import { applyChanges, createSaveQueue, mergeItems, type SaveReply, type SaveResult, type WorkChange } from "@/lib/work-store";
import type { WorkUser, WorkAccess } from "@/lib/work-auth";
import { mergeWorkDelta } from "@/lib/work-snapshot";

/** A full re-read this often (while the tab is open and visible) backs up the changes-only refreshes. */
const FULL_READ_MS = 30 * 60_000;
const FALLBACK_READ_MS = 60_000;
const LIVE_READ_MS = 15 * FALLBACK_READ_MS;

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
  /** Re-reads what changed in the workspace, in the background. */
  refresh: () => Promise<void>;
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

  // The newest snapshot this browser holds, for building on with a changes-only read.
  const current = useRef(snapshot);
  useEffect(() => { current.current = snapshot; }, [snapshot]);
  // The page's own render was a full read, so the next full one is due 30 minutes after it.
  const reading = useRef({ busy: false, again: false, fullAt: Date.parse(rendered.now) });
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
        // Only what changed since the snapshot on screen (Supabase bills every byte it sends),
        // with an occasional full read in case anything slipped past.
        const have = current.current;
        const full = have.error || Date.now() - state.fullAt > FULL_READ_MS;
        const url = full ? "/api/work/snapshot" : `/api/work/snapshot?since=${encodeURIComponent(have.now)}`;
        const response = await fetch(url, { cache: "no-store" });
        const next: WorkSnapshot | null = response.ok ? await response.json() : null;
        // A failed read keeps what is on screen rather than blanking the workspace.
        if (next && !next.error) {
          if (full) state.fullAt = Date.now();
          // Merged onto the snapshot it was asked against; a newer page render in the meantime wins.
          const merged = mergeWorkDelta(have, next);
          current.current = merged.now > current.current.now ? merged : current.current;
          setFetched((had) => (had && had.now >= merged.now ? had : merged));
        }
      } catch {
        // Offline: the next focus, ping or timer tries again.
      }
    } while (state.again);
    state.busy = false;
  }, []);
  useEffect(() => {
    // Stay in step with teammates: re-read on the database's "changed" ping (Work tables only),
    // when the tab comes back, and on a slow fallback timer.
    // A tab in the background doesn't read at all: it remembers it missed something and reads
    // once when it's looked at again.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let missed = false;
    let readAt = Date.now();
    let live = false;
    let wasConnected = false;
    const readInterval = () => live ? LIVE_READ_MS : FALLBACK_READ_MS;
    const soon = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) {
        missed = true;
        return;
      }
      const scheduledAt = Date.now();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden" || !navigator.onLine) {
          missed = true;
          return;
        }
        missed = false;
        readAt = scheduledAt;
        void refresh();
      }, 250);
    };
    const sb = supabaseBrowser();
    const channel = sb
      ?.channel("board")
      .on("broadcast", { event: "changed" }, (message) => {
        const table = (message.payload as { table?: string } | undefined)?.table;
        if (!table || table.startsWith("work_") || table === "pit_problems") soon();
      })
      .subscribe((status) => {
        const connected = status === "SUBSCRIBED";
        const reconnected = connected && !live && wasConnected;
        live = connected;
        wasConnected ||= connected;
        if (reconnected) soon();
      });
    // Catch up on missed changes or once the snapshot is due for its fallback read.
    const back = () => {
      if (missed || Date.now() - readAt >= readInterval()) soon();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    window.addEventListener("online", back);
    const interval = setInterval(() => {
      if (!live || Date.now() - readAt >= LIVE_READ_MS) soon();
    }, FALLBACK_READ_MS);
    return () => {
      if (channel) sb?.removeChannel(channel);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      window.removeEventListener("online", back);
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    // A page restored from the browser's back/forward cache can carry an old snapshot.
    if (document.visibilityState === "hidden" || Date.now() - Date.parse(rendered.now) <= 30_000) return;
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
