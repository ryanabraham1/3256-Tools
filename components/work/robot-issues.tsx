"use client";
import { useState } from "react";
import { PROBLEM_STATUS_LABEL, SEVERITIES, SEVERITY_LABEL, SEVERITY_TONE, type PitProblem, type Severity } from "@/lib/pit";
import { dateLabel, done, issueCode, type WorkItem } from "@/lib/work";
import { Empty } from "./collections";
import { Field, Modal } from "./editor";
import { Icon, StatusIcon, statusLabel } from "./icons";
import { useWork } from "./work-provider";

const SEVERITY_HELP: Record<Severity, string> = {
  minor: "Annoying, but the robot plays fine",
  major: "Hurts how the robot plays",
  critical: "The robot can't play until it's fixed",
};
const RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

/** Open first, worst first, newest first. */
export function sortProblems(problems: PitProblem[]) {
  return [...problems].sort(
    (a, b) =>
      Number(a.status !== "open") - Number(b.status !== "open") ||
      RANK[a.severity] - RANK[b.severity] ||
      b.occurred_at.localeCompare(a.occurred_at),
  );
}

/** Where it happened: the competition it was logged at, or the shop. */
function useWhere() {
  const { snapshot } = useWork();
  const names = new Map((snapshot.pitEvents ?? []).map((e) => [e.id, e.name]));
  return (p: PitProblem) => (p.event_id ? names.get(p.event_id) ?? "Competition" : "Shop");
}

/** Tasks made to fix this issue (most recent first). */
function fixTasks(problem: PitProblem, items: WorkItem[]) {
  return items.filter((i) => i.kind === "issue" && !i.deleted_at && i.data.problem === problem.id).sort((a, b) => b.number - a.number);
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`pill pill-${SEVERITY_TONE[severity]} work-severity`}>{SEVERITY_LABEL[severity]}</span>;
}

/** The Robot issues page: what's wrong with the robot, from the shop and the pit, and what's being done about it. */
export function RobotIssues({
  items,
  readOnly,
  onOpen,
  onReport,
  onMakeTask,
}: {
  items: WorkItem[];
  readOnly: boolean;
  onOpen: (item: WorkItem) => void;
  onReport: () => void;
  onMakeTask: (problem: PitProblem) => void;
}) {
  const { problems, setProblemStatus } = useWork();
  const where = useWhere();
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [area, setArea] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const open = problems.filter((p) => p.status === "open");
  const inView = show === "open" ? open : show === "closed" ? problems.filter((p) => p.status !== "open") : problems;
  const areas = [...new Set(inView.map((p) => p.area || "Unsorted"))].sort();
  const shown = sortProblems(inView.filter((p) => !area || (p.area || "Unsorted") === area));

  async function setStatus(p: PitProblem, status: PitProblem["status"]) {
    setError("");
    const result = await setProblemStatus(p, status);
    if (!result.ok) setError(result.error ?? "Couldn't save that.");
  }

  return (
    <div className="work-robot">
      <div className="work-toolbar">
        {(
          [
            ["open", `Open (${open.length})`],
            ["closed", "Fixed"],
            ["all", "All"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} className="work-control" data-active={show === value} onClick={() => { setShow(value); setArea(""); }}>
            {label}
          </button>
        ))}
        {areas.length > 1 && (
          <select className="work-control" aria-label="Subsystem" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Every subsystem</option>
            {areas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="work-error" role="alert">{error}</p>}
      {shown.length ? (
        <ul className="work-robot-list">
          {shown.map((p) => {
            const tasks = fixTasks(p, items);
            const task = tasks[0];
            const assignee = items.find((i) => i.id === task?.data.assignee);
            const isOpen = p.status === "open";
            const fixed = !!task && done(task) && isOpen;
            return (
              <li key={p.id} data-status={p.status}>
                <div className="work-robot-main">
                  <SeverityPill severity={p.severity} />
                  <button className="work-robot-title" aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                    <b>{p.title}</b>
                    <span>
                      {[p.area || "No subsystem", where(p), p.match_label, p.reported_by && `by ${p.reported_by}`, dateLabel(p.occurred_at)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                  {!isOpen && <span className="pill pill-good">{PROBLEM_STATUS_LABEL[p.status]}</span>}
                </div>
                {expanded === p.id && (
                  <div className="work-robot-details">
                    {p.details ? <p>{p.details}</p> : <p className="work-muted">No details added.</p>}
                    {p.fix && <p><b>Fixed at the event:</b> {p.fix}</p>}
                    {p.follow_up && <p><b>To do before next time:</b> {p.follow_up}</p>}
                  </div>
                )}
                <div className="work-robot-foot">
                  {task ? (
                    <button className="work-robot-task" onClick={() => onOpen(task)}>
                      <StatusIcon status={task.data.status} />
                      <span className="work-code">{issueCode(task, items)}</span>
                      {statusLabel(task.data.status)}
                      {assignee ? ` · ${assignee.title}` : " · nobody assigned"}
                    </button>
                  ) : (
                    isOpen && <span className="work-muted">No task yet</span>
                  )}
                  <div className="work-robot-actions">
                    {isOpen && !task && (
                      <button className="work-text-button" disabled={readOnly} onClick={() => onMakeTask(p)}>
                        <Icon name="plus" size={14} /> Make a task
                      </button>
                    )}
                    {isOpen ? (
                      <button className={fixed ? "btn btn-primary" : "work-text-button"} disabled={readOnly} onClick={() => setStatus(p, "fixed")}>
                        {fixed ? "Task done · mark fixed" : "Mark fixed"}
                      </button>
                    ) : (
                      <button className="work-text-button" disabled={readOnly} onClick={() => setStatus(p, "open")}>
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          icon="bot"
          title={show === "open" ? "Nothing wrong with the robot" : "No robot issues here"}
          description={show === "open" ? "When something breaks or acts up, report it so it gets fixed." : "Try another tab or subsystem."}
          action="Report an issue"
          onCreate={readOnly || show !== "open" ? undefined : onReport}
        />
      )}
    </div>
  );
}

/** "Report an issue": a short form anyone on the team can fill in from the shop or the pit. */
export function ReportIssueDialog({ items, onClose }: { items: WorkItem[]; onClose: () => void }) {
  const { problems, reportProblem, snapshot } = useWork();
  const event = snapshot.pitEvents?.find((e) => e.active);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [severity, setSeverity] = useState<Severity>("minor");
  const [details, setDetails] = useState("");
  const [atEvent, setAtEvent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Suggest the subsystems the team already uses: earlier issues and Subsystem labels.
  const areas = [
    ...new Set([
      ...items.filter((i) => i.kind === "label" && !i.deleted_at && !i.archived && i.data.group === "Subsystem").map((i) => i.title),
      ...problems.map((p) => p.area).filter(Boolean),
    ]),
  ].sort();

  return (
    <Modal title="Report a robot issue" onClose={onClose}>
      <form
        className="work-report-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const result = await reportProblem({ title, area, severity, details, atEvent });
          setBusy(false);
          if (result.ok) onClose();
          else setError(result.error ?? "Couldn't report the issue.");
        }}
      >
        <Field label="What's wrong?">
          <input
            className="input"
            data-autofocus
            required
            maxLength={200}
            placeholder="Intake jams when it picks up two notes"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Subsystem">
          <input className="input" list="work-robot-areas" maxLength={60} placeholder="Intake" value={area} onChange={(e) => setArea(e.target.value)} />
          <datalist id="work-robot-areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <div role="radiogroup" aria-label="How bad is it?" className="work-report-severity">
          <span>How bad is it?</span>
          {SEVERITIES.map((s) => (
            <button type="button" role="radio" aria-checked={severity === s} key={s} data-tone={SEVERITY_TONE[s]} onClick={() => setSeverity(s)}>
              <b>{SEVERITY_LABEL[s]}</b>
              <small>{SEVERITY_HELP[s]}</small>
            </button>
          ))}
        </div>
        <Field label="Details (optional)">
          <textarea className="input" rows={3} maxLength={2000} placeholder="What happened, when, and anything you already tried" value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        {event && (
          <label className="work-report-where">
            <input type="checkbox" checked={atEvent} onChange={(e) => setAtEvent(e.target.checked)} />
            This happened at {event.name}
          </label>
        )}
        {error && <p className="work-error" role="alert">{error}</p>}
        <div className="work-report-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !title.trim()}>
            {busy ? "Reporting…" : "Report issue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
