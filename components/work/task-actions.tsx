"use client";
import { useState } from "react";
import { done, isBlocked, type WorkData, type WorkItem } from "@/lib/work";
import { Icon } from "./icons";

const BLOCK_REASONS = ["Waiting on parts", "Waiting on another task", "Need help or a decision", "Machine or tool unavailable"];

/** Red "Blocked" tag for rows and cards; hovering shows why. */
export function BlockedBadge({ item }: { item: WorkItem }) {
  if (!isBlocked(item)) return null;
  return (
    <span className="work-blocked-badge" title={`Blocked: ${item.data.blocked}`}>
      Blocked
    </span>
  );
}

/** Who has the task, and a way to say it's stuck (and why) so a lead can see it. */
export function TaskActions({
  item,
  items,
  actor,
  readOnly,
  onPatch,
}: {
  item: WorkItem;
  items: WorkItem[];
  actor: string;
  readOnly: boolean;
  onPatch: (data: WorkData) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (done(item)) return null;
  const assignee = items.find((i) => i.id === item.data.assignee);
  const mine = !!actor && item.data.assignee === actor;

  if (isBlocked(item))
    return (
      <div className="work-blocked-banner" role="status">
        <Icon name="triage" size={18} />
        <div>
          <b>Blocked</b>
          <p>{item.data.blocked}</p>
        </div>
        <button className="btn btn-ghost" disabled={readOnly} onClick={() => onPatch({ blocked: "" })}>
          Unblock
        </button>
      </div>
    );

  if (asking)
    return (
      <form
        className="work-block-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          onPatch({ blocked: reason.trim() });
          setAsking(false);
          setReason("");
        }}
      >
        <label htmlFor={`block-${item.id}`}>What&apos;s blocking this?</label>
        <div className="work-block-reasons">
          {BLOCK_REASONS.map((r) => (
            <button type="button" key={r} data-active={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <input
          id={`block-${item.id}`}
          className="input"
          autoFocus
          maxLength={300}
          placeholder="Or describe it, e.g. waiting on 3/8&quot; bolts from McMaster"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="work-block-form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => { setAsking(false); setReason(""); }}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!reason.trim()}>
            Mark blocked
          </button>
        </div>
      </form>
    );

  return (
    <div className="work-task-actions">
      <span className="work-task-owner">
        {!item.data.assignee ? "Nobody is on this task yet" : mine ? "You're on this task" : `${assignee?.title ?? "Someone"} is on this task`}
      </span>
      <button className="btn btn-ghost" disabled={readOnly} onClick={() => setAsking(true)}>
        <Icon name="triage" size={15} /> I&apos;m stuck
      </button>
    </div>
  );
}
