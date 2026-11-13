"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  itemStats,
  pct,
  PHASE_LABEL,
  problemsByArea,
  recurringProblems,
  SEVERITY_TONE,
  type PitCheck,
  type PitEvent,
  type PitItem,
  type PitProblem,
  type PitRun,
} from "@/lib/pit";
import { ErrorText, Field, SubmitButton, useFabAction } from "./fab-ui";
import { savePitItem } from "@/app/pit-actions";
import { Sheet } from "./sheet";
import { Empty } from "./ui";

/** Post-competition review: what got checked, what got missed, what broke, and what to change. */
export function PitReview({
  events,
  eventId,
  items,
  runs,
  checks,
  problems,
  canWrite,
}: {
  events: PitEvent[];
  /** "" = every competition */
  eventId: string;
  items: PitItem[];
  runs: PitRun[];
  checks: PitCheck[];
  problems: PitProblem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [gap, setGap] = useState<PitProblem | null>(null);
  const event = events.find((e) => e.id === eventId);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const finished = runs.filter((r) => r.completed_at);
  const stats = itemStats(items, runs, checks, problems).filter((s) => s.runs > 0 || s.problems > 0);
  const totals = stats.reduce((t, s) => ({ ok: t.ok + s.ok, issue: t.issue + s.issue, missed: t.missed + s.missed, runs: t.runs + s.runs }), { ok: 0, issue: 0, missed: 0, runs: 0 });
  const mostMissed = stats.filter((s) => s.missed > 0).sort((a, b) => b.missRate - a.missRate || b.missed - a.missed);
  const catching = stats.filter((s) => s.issue > 0).sort((a, b) => b.issue - a.issue);
  const gaps = problems.filter((p) => !p.item_id);
  const recurring = recurringProblems(problems, (id) => itemById.get(id)?.title);
  const areas = problemsByArea(problems);
  const plan = problems.filter((p) => p.follow_up);
  const open = problems.filter((p) => p.status === "open");
  const [copied, setCopied] = useState(false);

  function copy() {
    const lines = [
      `# Pit review — ${event?.name ?? "All competitions"}`,
      "",
      `${finished.length} checklist runs · ${pct(totals.runs ? (totals.ok + totals.issue) / totals.runs : 0)} of checks done · ${totals.missed} missed · ${problems.length} problems (${open.length} still open, ${gaps.length} not on the checklist)`,
      "",
      "## Most missed checks",
      ...(mostMissed.length ? mostMissed.map((s) => `- ${s.item.title} (${PHASE_LABEL[s.item.phase]}) — missed ${s.missed}/${s.runs} (${pct(s.missRate)})`) : ["- None"]),
      "",
      "## Recurring problems",
      ...(recurring.length ? recurring.map((r) => `- ${r.label} — ${r.problems.length}×`) : ["- None"]),
      "",
      "## Problems the checklist doesn't cover",
      ...(gaps.length ? gaps.map((p) => `- ${p.title}${p.area ? ` [${p.area}]` : ""}${p.match_label ? ` (${p.match_label})` : ""}`) : ["- None"]),
      "",
      "## Problems by area",
      ...areas.map(([a, n]) => `- ${a}: ${n}`),
      "",
      "## Improvement plan",
      ...(plan.length ? plan.map((p) => `- [ ] ${p.follow_up} — from “${p.title}”`) : ["- Nothing written yet"]),
    ];
    navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap items-center">
        <select
          className="input w-auto"
          style={{ minHeight: 40, paddingTop: 4, paddingBottom: 4 }}
          value={eventId}
          onChange={(e) => router.push(`${pathname}?event=${e.target.value || "all"}`)}
          aria-label="Competition"
        >
          <option value="">Every competition</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.active ? " (now)" : ""}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost text-sm min-h-10 py-1.5 sm:ml-auto" onClick={copy}>
          {copied ? "Copied ✓" : "Copy review as text"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Runs finished" value={finished.length} />
        <Stat label="Checks done" value={totals.runs ? pct((totals.ok + totals.issue) / totals.runs) : "—"} tone={totals.missed ? "warn" : totals.runs ? "good" : undefined} />
        <Stat label="Problems" value={problems.length} tone={open.length ? "bad" : undefined} sub={open.length ? `${open.length} open` : undefined} />
        <Stat label="Not on checklist" value={gaps.length} tone={gaps.length ? "warn" : undefined} />
      </div>

      {finished.length === 0 && problems.length === 0 ? (
        <Empty>Nothing to review yet. Run a checklist or log a problem at a competition and it shows up here.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Section title="Most missed checks" hint="Checks nobody did before a run was finished. Move them earlier, make them critical, or give them an owner.">
            {mostMissed.length === 0 ? (
              <Good>No checks were missed.</Good>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {mostMissed.map((s) => (
                    <tr key={s.item.id} className="border-t first:border-t-0" style={{ borderColor: "var(--line)" }}>
                      <td className="py-2 pr-2">
                        <span className="font-medium">{s.item.title}</span>
                        {s.item.critical && <span className="pill pill-bad ml-1.5" style={{ fontSize: 11 }}>critical</span>}
                        <span className="block text-xs" style={{ color: "var(--muted)" }}>
                          {PHASE_LABEL[s.item.phase]}
                          {s.item.archived_at ? " · removed" : ""}
                        </span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap align-top">
                        <span className="mono font-semibold" style={{ color: "var(--warn)" }}>
                          {pct(s.missRate)}
                        </span>
                        <span className="block mono text-xs" style={{ color: "var(--muted)" }}>
                          {s.missed}/{s.runs} runs
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Recurring problems" hint="The same check or the same problem more than once.">
            {recurring.length === 0 ? (
              <Good>Nothing happened twice.</Good>
            ) : (
              <ul className="flex flex-col gap-2">
                {recurring.map((r) => (
                  <li key={r.key} className="text-sm">
                    <span className="mono font-semibold mr-2" style={{ color: "var(--bad)" }}>
                      {r.problems.length}×
                    </span>
                    <span className="font-medium">{r.label}</span>
                    <span className="block text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {r.problems.map((p) => p.match_label || p.title).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Not on the checklist" hint="Problems no check covers. Add a check if one would have caught it.">
            {gaps.length === 0 ? (
              <Good>Every problem maps to a check.</Good>
            ) : (
              <ul className="flex flex-col">
                {gaps.map((p) => (
                  <li key={p.id} className="py-2 border-t first:border-t-0 flex items-center gap-2" style={{ borderColor: "var(--line)" }}>
                    <span className={`pill pill-${SEVERITY_TONE[p.severity]} shrink-0`}>{p.severity}</span>
                    <Link href={`/pit/problems?id=${p.id}`} className="text-sm font-medium min-w-0 break-words hover:underline">
                      {p.title}
                      {p.area && <span className="font-normal" style={{ color: "var(--muted)" }}> · {p.area}</span>}
                    </Link>
                    {canWrite && (
                      <button type="button" className="btn btn-ghost text-sm min-h-10 py-1.5 ml-auto shrink-0" onClick={() => setGap(p)}>
                        Add a check
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Checks that caught problems" hint="These are earning their place.">
            {catching.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                No check has flagged a problem yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {catching.map((s) => (
                  <li key={s.item.id} className="text-sm flex justify-between gap-2">
                    <span>
                      {s.item.title} <span style={{ color: "var(--muted)" }}>· {PHASE_LABEL[s.item.phase]}</span>
                    </span>
                    <span className="mono font-semibold shrink-0">{s.issue}×</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Problems by area">
            {areas.length === 0 ? (
              <Good>No problems logged.</Good>
            ) : (
              <ul className="flex flex-col gap-2">
                {areas.map(([a, n]) => (
                  <li key={a} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{a}</span>
                      <span className="mono">{n}</span>
                    </div>
                    <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: "var(--line)" }}>
                      <div className="h-full" style={{ width: `${(n / areas[0][1]) * 100}%`, background: "var(--purple)" }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Improvement plan" hint="Every follow-up written on a problem. Edit a problem to add one.">
            {plan.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                No follow-ups yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {plan.map((p) => (
                  <li key={p.id} className="py-2 border-t first:border-t-0 text-sm" style={{ borderColor: "var(--line)" }}>
                    <span className="font-medium">{p.follow_up}</span>
                    <Link href={`/pit/problems?id=${p.id}`} className="block text-xs mt-0.5 hover:underline" style={{ color: "var(--muted)" }}>
                      from “{p.title}”{p.match_label ? ` · ${p.match_label}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      <Sheet open={!!gap} onClose={() => setGap(null)} title="Add a check" eyebrow={gap ? `From “${gap.title}”` : undefined}>
        {gap && <AddCheckForm problem={gap} onDone={() => setGap(null)} />}
      </Sheet>
    </div>
  );
}

function AddCheckForm({ problem, onDone }: { problem: PitProblem; onDone: () => void }) {
  const save = useFabAction(savePitItem, onDone);
  return (
    <form onSubmit={save.submit} className="flex flex-col gap-3">
      <input type="hidden" name="problem_id" value={problem.id} />
      <Field label="Check">
        <input name="title" className="input" defaultValue={problem.title} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="When">
          <select name="phase" className="input" defaultValue="pre_match">
            {Object.entries(PHASE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Section">
          <input name="section" className="input" defaultValue={problem.area} placeholder="Electrical" />
        </Field>
      </div>
      <Field label="How to check">
        <textarea name="how" className="input" defaultValue={problem.follow_up} style={{ minHeight: 60 }} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="critical" defaultChecked={problem.severity === "critical"} /> Critical — must be done every time
      </label>
      <ErrorText error={save.error} />
      <SubmitButton pending={save.pending} label="Add to checklist" />
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-medium tracking-tight">{title}</h2>
        {hint && (
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Good({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm" style={{ color: "var(--good)" }}>
      ✓ {children}
    </p>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number | string; tone?: string; sub?: string }) {
  return (
    <div className="card p-3 min-w-0">
      <p className="mono text-2xl font-semibold leading-none" style={{ color: tone ? `var(--${tone})` : "var(--ink)" }}>
        {value}
        {sub && <span className="text-xs font-normal ml-1.5" style={{ color: "var(--muted)" }}>{sub}</span>}
      </p>
      <p className="eyebrow mt-1.5 truncate" style={{ color: "var(--muted)", fontSize: 9.5, letterSpacing: "0.12em" }}>
        {label}
      </p>
    </div>
  );
}
