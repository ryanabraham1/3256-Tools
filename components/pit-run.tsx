"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { deletePitRun, finishPitRun, reopenPitRun, setPitCheck } from "@/app/pit-actions";
import { CHECK_LABEL, CHECK_TONE, runItems, runTitle, sortItems, type CheckStatus, type PitCheck, type PitItem, type PitProblem, type PitRun } from "@/lib/pit";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { ConfirmButton } from "./confirm-button";
import { ErrorText, useFabAction } from "./fab-ui";
import { ProblemForm } from "./pit-ui";
import { Sheet } from "./sheet";

type Mark = { item_id: string; status: CheckStatus | null };

const CRITICAL = "★critical";

export function PitRunView({
  run,
  items,
  checks,
  problems,
  areas,
  eventName,
  canWrite,
}: {
  run: PitRun;
  items: PitItem[];
  checks: PitCheck[];
  problems: PitProblem[];
  areas: string[];
  eventName: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [problemFor, setProblemFor] = useState<PitItem | null>(null);
  const byItem = new Map(checks.map((c) => [c.item_id, c]));
  const [marks, mark] = useOptimistic(
    new Map(checks.map((c) => [c.item_id, c.status as CheckStatus | null])),
    (m, next: Mark) => new Map(m).set(next.item_id, next.status),
  );
  const finish = useFabAction(finishPitRun);
  const reopen = useFabAction(reopenPitRun);
  const del = useFabAction(deletePitRun, () => router.push("/pit"));

  const finished = !!run.completed_at;
  // A finished run shows exactly what it covered; an open one shows the live checklist.
  const all = finished ? sortItems(items.filter((i) => byItem.has(i.id))) : runItems(run, items);
  const status = (id: string) => marks.get(id) ?? null;
  const isDone = (i: PitItem) => !!status(i.id) && status(i.id) !== "missed";
  const done = all.filter(isDone).length;
  const left = all.length - done;

  // Sections, in the checklist's order, so one person can take one section.
  const sectionOf = (i: PitItem) => i.section || "Other";
  const sections = [...new Set([...all].sort((a, b) => a.sort - b.sort).map(sectionOf))].map((name) => {
    const its = all.filter((i) => sectionOf(i) === name);
    return { name, total: its.length, done: its.filter(isDone).length };
  });
  const criticalItems = all.filter((i) => i.critical);
  const picked = sp.get("section") ?? "";
  const view = picked === CRITICAL || sections.some((x) => x.name === picked) ? picked : "";
  const ordered = view === CRITICAL ? criticalItems : view ? all.filter((i) => sectionOf(i) === view) : all;
  const nextSection = view && view !== CRITICAL
    ? [...sections.slice(sections.findIndex((x) => x.name === view) + 1), ...sections].find((x) => x.name !== view && x.done < x.total)
    : undefined;
  // In the full list: critical checks first, then a heading per section. A single section needs none.
  const headers = ordered.map((item, n) => {
    if (view) return null;
    const prev = ordered[n - 1];
    if (item.critical) return prev?.critical ? null : "Critical";
    return !prev || prev.critical || prev.section !== item.section ? sectionOf(item) : null;
  });

  function pick(name: string, chip?: HTMLElement) {
    const q = new URLSearchParams(sp.toString());
    if (name) q.set("section", name);
    else q.delete("section");
    // Native history keeps useSearchParams in sync without a server round trip.
    window.history.replaceState(null, "", q.size ? `${pathname}?${q}` : pathname);
    chip?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    // Bring the top of the list up under the sticky progress bar if it's scrolled past.
    const list = document.getElementById("pit-run-list")?.getBoundingClientRect().top;
    const bar = document.getElementById("pit-run-bar")?.getBoundingClientRect().bottom;
    if (list !== undefined && bar !== undefined && list < bar) window.scrollTo({ top: window.scrollY + list - bar - 8, behavior: "smooth" });
  }
  const criticalLeft = all.filter((i) => i.critical && (!status(i.id) || status(i.id) === "missed")).length;
  const editable = canWrite && !finished;

  function set(item: PitItem, s: CheckStatus | "clear") {
    setError(null);
    startTransition(async () => {
      mark({ item_id: item.id, status: s === "clear" ? null : s });
      const fd = new FormData();
      fd.set("run_id", run.id);
      fd.set("item_id", item.id);
      fd.set("status", s);
      const r = await setPitCheck(fd);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <Link href="/pit" className="text-sm underline" style={{ color: "var(--muted)" }}>
          ← Checklists
        </Link>
        <p className="eyebrow mt-3" style={{ color: "var(--muted)" }}>
          {eventName ?? "Practice"} · {finished ? `Finished ${fmtDateTime(run.completed_at!)}` : `Started ${timeAgo(run.started_at)}`}
          {run.started_by ? ` by ${run.started_by}` : ""}
        </p>
        <h1 className="display text-3xl sm:text-[34px] break-words">{runTitle(run)}</h1>
      </div>

      <div id="pit-run-bar" className="card p-4 flex flex-col gap-2 sticky z-10" style={{ top: "calc(var(--app-header-height, 0px) + 8px)" }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm">
            <span className="mono text-xl font-semibold">
              {done}/{all.length}
            </span>{" "}
            <span style={{ color: "var(--muted)" }}>checked</span>
            {criticalLeft > 0 && !finished && <span className="pill pill-bad ml-2">{criticalLeft} critical left</span>}
          </p>
          {editable && (
            <ConfirmButton
              label="Finish"
              className="btn btn-primary text-sm min-h-10 py-1.5"
              message={
                left
                  ? `${left} ${left === 1 ? "check hasn't" : "checks haven't"} been done. They'll be recorded as missed for the review.`
                  : "Everything's checked. Finish this run?"
              }
              confirmLabel={left ? `Finish with ${left} missed` : "Finish"}
              onConfirm={() => finish.call({ run_id: run.id })}
              pending={finish.pending}
            />
          )}
          {finished && canWrite && (
            <button type="button" className="btn btn-ghost text-sm min-h-10 py-1.5" onClick={() => reopen.call({ run_id: run.id })} disabled={reopen.pending}>
              Reopen
            </button>
          )}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
          <div className="h-full transition-all" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%`, background: left ? "var(--purple)" : "var(--good)" }} />
        </div>
        {sections.length > 1 && (
          <nav className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pt-1 pb-0.5 [scrollbar-width:none]" aria-label="Sections">
            <SectionChip label="All" done={done} total={all.length} on={!view} onPick={(el) => pick("", el)} />
            {criticalItems.length > 0 && (
              <SectionChip label="Critical" done={criticalItems.filter(isDone).length} total={criticalItems.length} on={view === CRITICAL} critical onPick={(el) => pick(CRITICAL, el)} />
            )}
            {sections.map((x) => (
              <SectionChip key={x.name} label={x.name} done={x.done} total={x.total} on={view === x.name} onPick={(el) => pick(x.name, el)} />
            ))}
          </nav>
        )}
        <ErrorText error={error ?? finish.error ?? reopen.error} />
      </div>

      <ul id="pit-run-list" className="card overflow-hidden">
        {ordered.map((item, n) => {
          const s = status(item.id);
          const c = byItem.get(item.id);
          const header = headers[n];
          const itemProblems = problems.filter((p) => p.item_id === item.id);
          return (
            <li key={item.id}>
              {header && (
                <p
                  className="eyebrow px-4 pt-3 pb-1.5 border-t first:border-t-0"
                  style={{ color: header === "Critical" ? "var(--bad)" : "var(--muted)", borderColor: "var(--line)" }}
                >
                  {header}
                </p>
              )}
              <div className="px-4 py-3 border-t flex gap-3 items-start" style={{ borderColor: "var(--line)", opacity: s === "na" ? 0.6 : 1 }}>
                <button
                  type="button"
                  className="w-11 h-11 shrink-0 rounded-[10px] flex items-center justify-center border-2 text-lg"
                  style={{
                    borderColor: s === "ok" ? "var(--good)" : s === "issue" ? "var(--bad)" : s === "missed" ? "var(--warn)" : "var(--line)",
                    background: s === "ok" ? "var(--good-soft)" : s === "issue" ? "var(--bad-soft)" : s === "missed" ? "var(--warn-soft)" : "var(--surface)",
                    color: s === "ok" ? "var(--good)" : s === "issue" ? "var(--bad)" : "var(--warn)",
                  }}
                  onClick={() => set(item, s === "ok" ? "clear" : "ok")}
                  disabled={!editable}
                  aria-pressed={s === "ok"}
                  aria-label={s === "ok" ? `Uncheck ${item.title}` : `Check ${item.title}`}
                >
                  {s === "ok" ? "✓" : s === "issue" ? "!" : s === "missed" ? "–" : ""}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug break-words">
                    {item.title}
                    {item.critical && item.section && (
                      <span className="chip ml-2 align-middle" style={{ fontSize: 11 }}>
                        {item.section}
                      </span>
                    )}
                  </p>
                  {item.how && (
                    <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
                      {item.how}
                    </p>
                  )}
                  {s && s !== "ok" && (
                    <p className="text-xs mt-1">
                      <span className={`pill pill-${CHECK_TONE[s]}`}>{CHECK_LABEL[s]}</span>
                      {c?.note && <span className="ml-2">{c.note}</span>}
                    </p>
                  )}
                  {c?.checked_by && s !== "missed" && (
                    <p className="mono text-[11px] mt-1" style={{ color: "var(--muted)" }}>
                      {c.checked_by} · {timeAgo(c.checked_at)}
                    </p>
                  )}
                  {itemProblems.length > 0 && (
                    <Link href={`/pit/problems?item=${item.id}`} className="text-xs underline mt-1 inline-block" style={{ color: "var(--muted)" }}>
                      {itemProblems.length} problem{itemProblems.length === 1 ? "" : "s"} logged on this check
                    </Link>
                  )}
                </div>
                {editable && (
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" className="btn btn-ghost text-sm min-h-11 px-2.5" onClick={() => setProblemFor(item)} title="Log a problem found by this check">
                      Problem
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-sm min-h-11 px-2.5"
                      onClick={() => set(item, s === "na" ? "clear" : "na")}
                      aria-pressed={s === "na"}
                      title="Doesn't apply this time"
                    >
                      N/A
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {ordered.length === 0 && (
          <li className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            No checks in this list. Add some in{" "}
            <Link href="/pit/setup" className="underline">
              Setup
            </Link>
            .
          </li>
        )}
      </ul>

      {nextSection && (
        <button type="button" className="btn btn-ghost w-full" onClick={() => pick(nextSection.name)}>
          Next: {nextSection.name}{" "}
          <span className="mono text-sm" style={{ color: "var(--muted)" }}>
            {nextSection.done}/{nextSection.total}
          </span>{" "}
          <span aria-hidden>→</span>
        </button>
      )}

      {canWrite && (
        <div>
          <ConfirmButton
            label="Delete this run"
            message="The run and its checks are removed from the review. Problems logged from it stay."
            onConfirm={() => del.call({ run_id: run.id })}
            pending={del.pending}
            danger
            link
          />
          <ErrorText error={del.error} />
        </div>
      )}

      <Sheet open={!!problemFor} onClose={() => setProblemFor(null)} title="Log a problem" eyebrow={problemFor?.title}>
        {problemFor && (
          <ProblemForm items={items} areas={areas} item={problemFor} runId={run.id} matchLabel={run.label} onDone={() => setProblemFor(null)} />
        )}
      </Sheet>
    </div>
  );
}

function SectionChip({
  label,
  done,
  total,
  on,
  critical,
  onPick,
}: {
  label: string;
  done: number;
  total: number;
  on: boolean;
  critical?: boolean;
  onPick: (el: HTMLElement) => void;
}) {
  const complete = total > 0 && done >= total;
  return (
    <button
      type="button"
      className="tile tile-chip shrink-0 flex items-center gap-1.5"
      data-selected={on}
      aria-pressed={on}
      onClick={(e) => onPick(e.currentTarget)}
      style={!on && complete ? { borderColor: "var(--good)", color: "var(--good)" } : !on && critical ? { color: "var(--bad)" } : undefined}
    >
      {complete && <span aria-hidden>✓</span>}
      {label}
      <span className="mono text-xs opacity-75">
        {done}/{total}
      </span>
    </button>
  );
}
