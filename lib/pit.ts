/** Pit checklist: types, labels and the post-competition review maths. Client-safe. */

export const PHASES = ["morning", "pre_match", "post_match", "end_of_day"] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABEL: Record<Phase, string> = {
  morning: "Start of day",
  pre_match: "Pre-match",
  post_match: "Post-match",
  end_of_day: "End of day",
};
export const isPhase = (v: string): v is Phase => (PHASES as readonly string[]).includes(v);

export type CheckStatus = "ok" | "issue" | "missed" | "na";
export const CHECK_LABEL: Record<CheckStatus, string> = { ok: "Checked", issue: "Problem", missed: "Missed", na: "N/A" };
export const CHECK_TONE: Record<CheckStatus, string> = { ok: "good", issue: "bad", missed: "warn", na: "muted" };

export const SEVERITIES = ["minor", "major", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { minor: "Minor", major: "Major", critical: "Critical" };
export const SEVERITY_TONE: Record<Severity, string> = { minor: "muted", major: "warn", critical: "bad" };

export const PROBLEM_STATUSES = ["open", "fixed", "wont_fix"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
export const PROBLEM_STATUS_LABEL: Record<ProblemStatus, string> = { open: "Open", fixed: "Fixed", wont_fix: "Won't fix" };
export const PROBLEM_STATUS_TONE: Record<ProblemStatus, string> = { open: "bad", fixed: "good", wont_fix: "muted" };

export interface PitEvent {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  active: boolean;
  created_at: string;
}

export interface PitItem {
  id: string;
  phase: Phase;
  section: string;
  title: string;
  how: string;
  critical: boolean;
  sort: number;
  archived_at: string | null;
  created_at: string;
}

export interface PitRun {
  id: string;
  event_id: string | null;
  phase: Phase;
  label: string;
  started_by: string;
  started_at: string;
  completed_at: string | null;
  completed_by: string;
}

export interface PitCheck {
  id: string;
  run_id: string;
  item_id: string;
  status: CheckStatus;
  note: string;
  checked_by: string;
  checked_at: string;
}

export interface PitProblem {
  id: string;
  event_id: string | null;
  item_id: string | null;
  run_id: string | null;
  title: string;
  details: string;
  area: string;
  match_label: string;
  severity: Severity;
  status: ProblemStatus;
  fix: string;
  follow_up: string;
  reported_by: string;
  occurred_at: string;
  resolved_at: string | null;
  created_at: string;
}

/** Critical first, then section, then the set order. */
export function sortItems(items: PitItem[]): PitItem[] {
  return [...items].sort(
    (a, b) => Number(b.critical) - Number(a.critical) || a.section.localeCompare(b.section) || a.sort - b.sort || a.title.localeCompare(b.title),
  );
}

/** The items a run covers: its phase, not archived before the run started. */
export function runItems(run: PitRun, items: PitItem[]): PitItem[] {
  return sortItems(
    items.filter(
      (i) =>
        i.phase === run.phase &&
        // Items added after a finished run weren't part of it.
        (!run.completed_at || i.created_at <= run.completed_at) &&
        (!i.archived_at || i.archived_at > run.started_at),
    ),
  );
}

export function runTitle(run: PitRun): string {
  return run.label ? `${PHASE_LABEL[run.phase]} · ${run.label}` : PHASE_LABEL[run.phase];
}

export interface ItemStats {
  item: PitItem;
  ok: number;
  issue: number;
  missed: number;
  na: number;
  /** finished runs the item was part of */
  runs: number;
  /** missed / runs */
  missRate: number;
  problems: number;
}

/** Per-check counts across finished runs, for "what gets checked and what gets missed". */
export function itemStats(items: PitItem[], runs: PitRun[], checks: PitCheck[], problems: PitProblem[]): ItemStats[] {
  const finished = new Map(runs.filter((r) => r.completed_at).map((r) => [r.id, r]));
  const stats = new Map<string, ItemStats>(
    items.map((item) => [item.id, { item, ok: 0, issue: 0, missed: 0, na: 0, runs: 0, missRate: 0, problems: 0 }]),
  );
  for (const c of checks) {
    const s = stats.get(c.item_id);
    if (!s || !finished.has(c.run_id)) continue;
    s[c.status]++;
    s.runs++;
  }
  for (const p of problems) {
    const s = p.item_id ? stats.get(p.item_id) : undefined;
    if (s) s.problems++;
  }
  for (const s of stats.values()) s.missRate = s.runs ? s.missed / s.runs : 0;
  return [...stats.values()];
}

export interface Recurring {
  key: string;
  label: string;
  problems: PitProblem[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Problems that happened more than once: same check, same title, or same area. */
export function recurringProblems(problems: PitProblem[], itemTitle: (id: string) => string | undefined): Recurring[] {
  const groups = new Map<string, Recurring>();
  const add = (key: string, label: string, p: PitProblem) => {
    const g = groups.get(key) ?? { key, label, problems: [] };
    g.problems.push(p);
    groups.set(key, g);
  };
  for (const p of problems) {
    const title = p.item_id ? itemTitle(p.item_id) : undefined;
    if (p.item_id && title) add(`item:${p.item_id}`, `Check: ${title}`, p);
    else add(`title:${norm(p.title)}`, p.title, p);
  }
  return [...groups.values()].filter((g) => g.problems.length > 1).sort((a, b) => b.problems.length - a.problems.length);
}

/** Count of problems per area (subsystem), most first. */
export function problemsByArea(problems: PitProblem[]): [string, number][] {
  const m = new Map<string, number>();
  for (const p of problems) m.set(p.area || "Unsorted", (m.get(p.area || "Unsorted") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
