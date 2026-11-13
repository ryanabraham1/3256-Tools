"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { startPitRun } from "@/app/pit-actions";
import {
  PHASES,
  PHASE_LABEL,
  runItems,
  runTitle,
  SEVERITY_TONE,
  type Phase,
  type PitCheck,
  type PitEvent,
  type PitItem,
  type PitProblem,
  type PitRun,
} from "@/lib/pit";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { useCompMode } from "./comp-mode";
import { ErrorText, useFabAction } from "./fab-ui";
import { NoEventNote, ProblemForm } from "./pit-ui";
import { Sheet } from "./sheet";
import { Empty } from "./ui";

export function PitHome({
  event,
  hasEvents,
  items,
  runs,
  checks,
  problems,
  canWrite,
}: {
  event: PitEvent | null;
  hasEvents: boolean;
  items: PitItem[];
  runs: PitRun[];
  checks: PitCheck[];
  problems: PitProblem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { compMode, matchLabel } = useCompMode();
  const [phase, setPhase] = useState<Phase | null>(null);
  const [logging, setLogging] = useState(false);
  const start = useFabAction(startPitRun, (runId) => runId && router.push(`/pit/run/${runId}`));
  const live = items.filter((i) => !i.archived_at);
  const open = runs.filter((r) => !r.completed_at);
  const finished = runs.filter((r) => r.completed_at).slice(0, 12);
  const openProblems = problems.filter((p) => p.status === "open");
  const areas = [...new Set(problems.map((p) => p.area).filter(Boolean))].sort();
  const byRun = new Map<string, PitCheck[]>();
  for (const c of checks) byRun.set(c.run_id, [...(byRun.get(c.run_id) ?? []), c]);

  return (
    <div className="flex flex-col gap-4">
      {!event && <NoEventNote hasEvents={hasEvents} />}

      {canWrite && (
        <section className="card p-4 flex flex-col gap-3">
          <p className="eyebrow" style={{ color: "var(--muted)" }}>
            Start a checklist
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {PHASES.map((p) => {
              const n = live.filter((i) => i.phase === p).length;
              return (
                <button key={p} type="button" className="tile text-left" data-selected={phase === p} onClick={() => setPhase(phase === p ? null : p)} disabled={!n}>
                  <span className="block font-semibold">{PHASE_LABEL[p]}</span>
                  <span className="block text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    {n} {n === 1 ? "check" : "checks"}
                  </span>
                </button>
              );
            })}
          </div>
          {phase && (
            <form onSubmit={start.submit} className="flex gap-2 items-end flex-wrap fade-in">
              <input type="hidden" name="phase" value={phase} />
              <label className="flex-1 min-w-[160px]">
                <span className="label">{phase === "pre_match" || phase === "post_match" ? "Match" : "Label (optional)"}</span>
                <input
                  key={phase}
                  name="label"
                  className="input"
                  defaultValue={(phase === "pre_match" || phase === "post_match") && compMode ? matchLabel : ""}
                  placeholder={phase === "pre_match" || phase === "post_match" ? "Q12" : "Saturday"}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={start.pending}>
                {start.pending ? "Starting…" : `Start ${PHASE_LABEL[phase].toLowerCase()}`} <span aria-hidden>→</span>
              </button>
              <div className="w-full">
                <ErrorText error={start.error} />
              </div>
            </form>
          )}
        </section>
      )}

      {open.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="eyebrow" style={{ color: "var(--muted)" }}>
            In progress
          </p>
          {open.map((r) => (
            <RunRow key={r.id} run={r} items={items} checks={byRun.get(r.id) ?? []} />
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <section className="card">
          <div className="p-4 pb-2 flex items-center justify-between gap-2">
            <p className="eyebrow" style={{ color: "var(--muted)" }}>
              Open problems
            </p>
            {canWrite && (
              <button type="button" className="btn btn-ghost text-sm min-h-10 py-1.5" onClick={() => setLogging(true)}>
                + Log problem
              </button>
            )}
          </div>
          {openProblems.length === 0 ? (
            <p className="px-4 pb-4 text-sm" style={{ color: "var(--good)" }}>
              ✓ Nothing open.
            </p>
          ) : (
            <ul className="px-4 pb-2">
              {openProblems.slice(0, 8).map((p) => (
                <li key={p.id} className="py-2 border-t first:border-t-0 flex items-baseline gap-2" style={{ borderColor: "var(--line)" }}>
                  <span className={`pill pill-${SEVERITY_TONE[p.severity]} shrink-0`}>{p.severity}</span>
                  <Link href={`/pit/problems?id=${p.id}`} className="text-sm font-medium hover:underline min-w-0 break-words">
                    {p.title}
                  </Link>
                  <span className="ml-auto mono text-[11px] shrink-0" style={{ color: "var(--muted)" }}>
                    {p.match_label || timeAgo(p.occurred_at)}
                  </span>
                </li>
              ))}
              {openProblems.length > 8 && (
                <li className="py-2">
                  <Link href="/pit/problems" className="text-xs underline" style={{ color: "var(--muted)" }}>
                    +{openProblems.length - 8} more
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <p className="eyebrow" style={{ color: "var(--muted)" }}>
            Recent runs
          </p>
          {finished.length === 0 ? (
            <Empty>No finished checklists{event ? " at this competition" : ""} yet.</Empty>
          ) : (
            finished.map((r) => <RunRow key={r.id} run={r} items={items} checks={byRun.get(r.id) ?? []} />)
          )}
        </section>
      </div>

      <Sheet open={logging} onClose={() => setLogging(false)} title="Log a problem" eyebrow={event?.name ?? "Practice"}>
        {logging && <ProblemForm items={items} areas={areas} onDone={() => setLogging(false)} />}
      </Sheet>
    </div>
  );
}

function RunRow({ run, items, checks }: { run: PitRun; items: PitItem[]; checks: PitCheck[] }) {
  const total = run.completed_at ? checks.length : runItems(run, items).length;
  const count = (s: PitCheck["status"]) => checks.filter((c) => c.status === s).length;
  const done = checks.filter((c) => c.status !== "missed").length;
  const missed = count("missed");
  const issues = count("issue");
  return (
    <Link href={`/pit/run/${run.id}`} className="card p-3 flex items-center gap-3 hover:bg-[var(--paper)]">
      <div className="min-w-0 flex-1">
        <p className="font-semibold truncate">{runTitle(run)}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
          {run.completed_at ? `Finished ${fmtDateTime(run.completed_at)}` : `Started ${timeAgo(run.started_at)}`}
          {run.started_by ? ` · ${run.started_by}` : ""}
        </p>
      </div>
      <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
        {issues > 0 && <span className="pill pill-bad">{issues} problem{issues === 1 ? "" : "s"}</span>}
        {missed > 0 && <span className="pill pill-warn">{missed} missed</span>}
        <span className={`pill ${run.completed_at ? (missed ? "pill-muted" : "pill-good") : "pill-purple"}`}>
          {done}/{total}
        </span>
      </div>
    </Link>
  );
}
