"use client";

import Link from "next/link";
import { useState } from "react";
import { savePitProblem } from "@/app/pit-actions";
import {
  PHASE_LABEL,
  PROBLEM_STATUSES,
  PROBLEM_STATUS_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  sortItems,
  type PitItem,
  type PitProblem,
} from "@/lib/pit";
import { useCompMode } from "./comp-mode";
import { ErrorText, Field, SubmitButton, useFabAction } from "./fab-ui";

/** Log or edit a problem. From a check (`item` + `runId`) it's tied to that check. */
export function ProblemForm({
  problem,
  items,
  areas,
  item,
  runId,
  matchLabel: runLabel,
  onDone,
}: {
  problem?: PitProblem;
  items: PitItem[];
  /** existing areas, offered as suggestions */
  areas: string[];
  item?: PitItem;
  runId?: string;
  matchLabel?: string;
  onDone: () => void;
}) {
  const { compMode, matchLabel } = useCompMode();
  const save = useFabAction(savePitProblem, onDone);
  const [severity, setSeverity] = useState(problem?.severity ?? "minor");
  const [status, setStatus] = useState(problem?.status ?? "open");
  const live = sortItems(items.filter((i) => !i.archived_at || i.id === problem?.item_id));
  const itemId = problem ? (problem.item_id ?? "") : (item?.id ?? "");

  return (
    <form onSubmit={save.submit} className="flex flex-col gap-3">
      {problem && <input type="hidden" name="id" value={problem.id} />}
      {runId && <input type="hidden" name="run_id" value={runId} />}
      <input type="hidden" name="severity" value={severity} />
      <input type="hidden" name="status" value={status} />
      <Field label="What went wrong">
        <input name="title" className="input" defaultValue={problem?.title ?? (item ? item.title : "")} placeholder="Radio lost power after hit" required autoFocus={!item} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Area">
          <input name="area" className="input" list="pit-areas" defaultValue={problem?.area ?? item?.section ?? ""} placeholder="Electrical" />
        </Field>
        <Field label="Match">
          <input name="match_label" className="input" defaultValue={problem?.match_label ?? runLabel ?? (compMode ? matchLabel : "")} placeholder="Q12" />
        </Field>
      </div>
      <datalist id="pit-areas">
        {areas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <div>
        <span className="label">Severity</span>
        <div className="flex gap-2 flex-wrap">
          {SEVERITIES.map((s) => (
            <button key={s} type="button" className="tile tile-chip" data-selected={severity === s} onClick={() => setSeverity(s)}>
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <Field label="Checklist item" hint="Leave as “Not on the checklist” when no check covers it — the review lists those as gaps.">
        <select name="item_id" className="input" defaultValue={itemId}>
          <option value="">Not on the checklist</option>
          {live.map((i) => (
            <option key={i.id} value={i.id}>
              {PHASE_LABEL[i.phase]} · {i.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Details">
        <textarea name="details" className="input" defaultValue={problem?.details ?? ""} placeholder="What happened, what you saw" />
      </Field>
      <div>
        <span className="label">Status</span>
        <div className="flex gap-2 flex-wrap">
          {PROBLEM_STATUSES.map((s) => (
            <button key={s} type="button" className="tile tile-chip" data-selected={status === s} onClick={() => setStatus(s)}>
              {PROBLEM_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <Field label="Fix at the event">
        <textarea name="fix" className="input" defaultValue={problem?.fix ?? ""} placeholder="Re-crimped the barrel jack" style={{ minHeight: 60 }} />
      </Field>
      <Field label="Follow-up" hint="What to change before next time — this is the improvement plan in the review.">
        <textarea name="follow_up" className="input" defaultValue={problem?.follow_up ?? ""} placeholder="Strain relief on radio power" style={{ minHeight: 60 }} />
      </Field>
      <ErrorText error={save.error} />
      <SubmitButton pending={save.pending} label={problem ? "Save problem" : "Log problem"} />
    </form>
  );
}

export function NoEventNote({ hasEvents }: { hasEvents: boolean }) {
  return (
    <p className="text-sm" style={{ color: "var(--muted)" }}>
      No competition is active, so runs and problems are logged as practice.{" "}
      <Link href="/pit/setup" className="underline">
        {hasEvents ? "Make one active" : "Add a competition"}
      </Link>{" "}
      to group them for the review.
    </p>
  );
}
