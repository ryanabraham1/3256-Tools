"use client";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  activeWorkItems,
  dateLabel,
  done,
  issueCode,
  milestoneProgress,
  KIND_NAMES,
  PRIORITIES,
  progress,
  STATUSES,
  uniqueStatuses,
  type WorkData,
  type WorkEvent,
  type WorkItem,
  type WorkKind,
} from "@/lib/work";
import { Avatar, IssueRows, LabelPicker } from "./collections";
import { CommitInput, EntitySelect, Field } from "./editor";
import { Icon, PriorityIcon, StatusIcon, statusLabel, statusTone } from "./icons";
import type { MilestoneActions } from "./milestone-menu";
import { ProjectDetail } from "./project-detail";
import type { IssueActions } from "./issue-menu";
import { itemRoute, useItemMenuShow } from "./item-menu";
import { InlineEdit, PropertyPicker } from "./property-picker";
export function RichText({ text }: { text: string }) {
  return (
    <div className="work-rich-text">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}
/** "set status to Done, assigned Sam" rather than a bare "updated this task". */
function describeUpdate(e: WorkEvent, item: WorkItem, items: WorkItem[]) {
  const before = (e.data.before as WorkItem | undefined) ?? undefined;
  const after = (e.data.after as WorkItem | undefined) ?? undefined;
  const fallback = `updated this ${KIND_NAMES[item.kind].toLowerCase()}`;
  if (!before || !after) return fallback;
  const a = before.data ?? {}, b = after.data ?? {};
  const name = (id?: string) => items.find((i) => i.id === id)?.title;
  const parts: string[] = [];
  if (before.title !== after.title && after.title) parts.push(`renamed it to “${after.title}”`);
  if (a.status !== b.status) parts.push(`set status to ${statusLabel(b.status)}`);
  if ((a.priority ?? 0) !== (b.priority ?? 0)) parts.push(b.priority ? `set priority to ${PRIORITIES[b.priority]}` : "cleared the priority");
  if (a.assignee !== b.assignee) parts.push(b.assignee ? `assigned ${name(b.assignee) ?? "someone"}` : "removed the assignee");
  if (a.due !== b.due) parts.push(b.due ? `set the due date to ${dateLabel(b.due)}` : "cleared the due date");
  if (a.project !== b.project) parts.push(b.project ? `moved it to ${name(b.project) ?? "a project"}` : "removed it from its project");
  if (a.milestone !== b.milestone) parts.push(b.milestone ? `set the milestone to ${name(b.milestone) ?? "a milestone"}` : "cleared the milestone");
  if ((a.labels ?? []).join() !== (b.labels ?? []).join()) parts.push("changed the labels");
  if ((a.description ?? "") !== (b.description ?? "")) parts.push("edited the description");
  if ((a.estimate ?? 0) !== (b.estimate ?? 0)) parts.push(b.estimate ? `set the estimate to ${b.estimate}` : "cleared the estimate");
  return parts.length ? parts.join(", ") : fallback;
}
export function ItemDetail({
  item,
  items,
  events,
  actor,
  readOnly,
  posting,
  onEdit,
  onPatch,
  onComment,
  onOpen,
  onCreate,
  onArchive,
  onDelete,
  milestoneActions,
  issueActions,
}: {
  milestoneActions: MilestoneActions;
  issueActions: IssueActions;
  item: WorkItem;
  items: WorkItem[];
  events: WorkEvent[];
  actor: string;
  readOnly: boolean;
  /** A comment or update is on its way to the server. */
  posting: boolean;
  onEdit: () => void;
  onPatch: (data: WorkData) => void;
  onComment: (body: string, type?: string) => Promise<boolean>;
  onOpen: (item: WorkItem) => void;
  onCreate: (kind: WorkKind, preset?: WorkData) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [copyState, setCopyState] = useState<"" | "copied" | "failed">("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [comment, setComment] = useState("");
  const [relationId, setRelationId] = useState("");
  const [relationType, setRelationType] = useState<
    "blocks" | "blocked by" | "related" | "duplicate of"
  >("related");
  const issue = item.kind === "issue";
  const live = activeWorkItems(items);
  const projects = live.filter(
    (i) =>
      i.kind === "project" && i.data.initiative === item.id && !i.deleted_at,
  );
  const children = live.filter(
    (i) =>
      !i.deleted_at &&
      !i.archived &&
      (issue
        ? i.data.parent === item.id
        : item.kind === "initiative"
          ? projects.some((p) => i.data.project === p.id)
          : item.kind === "milestone"
            ? i.data.milestone === item.id
            : i.data.project === item.id),
  );
  const inverse = items.flatMap((i) =>
    (i.data.relations ?? [])
      .filter((r) => r.id === item.id && !i.deleted_at)
      .map((r) => ({
        id: i.id,
        type:
          r.type === "blocks"
            ? "blocked by"
            : r.type === "blocked by"
              ? "blocks"
              : r.type === "duplicate of"
                ? "has duplicate"
                : "related",
      })),
  );
  const menuFor = useItemMenuShow();
  const history = events
    .filter((e) => e.item_id === item.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (item.kind === "project") return <ProjectDetail key={item.id} {...{item, items, events, readOnly, posting, onEdit, onPatch, onComment, onOpen, onCreate, onArchive, onDelete, milestoneActions, issueActions}} />;
  return (
    <div className="work-detail" data-kind={item.kind}>
      <div className="work-detail-main">
        <div className="work-detail-kicker">
          <span className="work-code">
            {issue ? issueCode(item, items) : KIND_NAMES[item.kind]}
          </span>
          <div className="work-detail-actions">
            <button
              className="work-icon-button"
              aria-label="Favorite"
              aria-pressed={!!actor && !!item.data.favorites?.includes(actor)}
              disabled={!actor || readOnly}
              onClick={() =>
                onPatch({
                  favorites: item.data.favorites?.includes(actor)
                    ? item.data.favorites.filter((v) => v !== actor)
                    : [...(item.data.favorites ?? []), actor],
                })
              }
            >
              <Icon name="star" />
            </button>
            <button
              className="work-icon-button"
              aria-label="Copy link"
              title={copyState === "copied" ? "Link copied" : copyState === "failed" ? "Couldn't copy — copy the address bar instead" : "Copy link"}
              onClick={() =>
                navigator.clipboard.writeText(window.location.origin + itemRoute(item)).then(
                  () => { setCopyState("copied"); setTimeout(() => setCopyState(""), 1800); },
                  () => { setCopyState("failed"); setTimeout(() => setCopyState(""), 3000); },
                )
              }
            >
              <Icon name={copyState === "copied" ? "check" : copyState === "failed" ? "close" : "link"} />
            </button>
            <button className="btn btn-ghost" onClick={onEdit}>
              Edit
            </button>
          </div>
        </div>
        <InlineEdit label="Title" value={item.title} disabled={readOnly} onSave={title => milestoneActions.onSave(item, { title })}><h1>{item.title}</h1></InlineEdit>
        {issue && item.data.parent && <button className="work-issue-parent" onClick={() => { const parent = items.find(i => i.id === item.data.parent); if (parent) onOpen(parent); }}><span>Sub-task of</span><StatusIcon status={items.find(i => i.id === item.data.parent)?.data.status}/>{items.find(i => i.id === item.data.parent)?.title}</button>}
        {issue && (
          <div className="work-status-choice" role="radiogroup" aria-label="Status">
            {["Backlog", "Todo", "In progress", "Done"].map((s) => {
              const on = (item.data.status ?? "Backlog").toLowerCase() === s.toLowerCase();
              return (
                <button key={s} role="radio" aria-checked={on} data-tone={statusTone(s)} disabled={readOnly} onClick={() => !on && onPatch({ status: s })}>
                  <span aria-hidden />
                  {statusLabel(s)}
                </button>
              );
            })}
          </div>
        )}
        <InlineEdit label="Description" multiline value={item.data.description ?? ""} disabled={readOnly} placeholder="Add a description…" onSave={description => onPatch({ description })}>
          {item.data.description ? <RichText text={item.data.description} /> : <span className="work-description-placeholder">Add a description…</span>}
        </InlineEdit>
        {!!item.data.attachments?.length && (
          <div className="work-import-attachments">
            {item.data.attachments.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                <Icon name="link" size={14} />
                {a.title}
              </a>
            ))}
          </div>
        )}
        {item.data.url && (
          <a
            className="work-reference"
            href={item.data.url}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="link" size={15} />
            {item.data.url}
          </a>
        )}
        {item.kind === "initiative" && (
          <section className="work-detail-section">
            <div className="work-section-title">
              <h2>Projects</h2>
              <button
                className="work-text-button"
                onClick={() => onCreate("project", { initiative: item.id })}
              >
                <Icon name="plus" size={14} />
                Add project
              </button>
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                className="work-child"
                onClick={() => onOpen(p)}
                onContextMenu={menuFor(p)}
              >
                <Icon name="projects" />
                <span>{p.title}</span>
                <span className="work-muted">{p.data.status}</span>
              </button>
            ))}
          </section>
        )}
        {!["document", "template", "label", "team", "member", "view"].includes(
          item.kind,
        ) && (
          <section className="work-detail-section">
            <div className="work-section-title">
              <h2>
                {issue ? "Sub-tasks" : "Tasks"}
                <span>
                  {children.filter((i) => i.kind === "issue" && done(i)).length} of {children.filter((i) => i.kind === "issue").length} done
                </span>
              </h2>
              {children.some((i) => i.kind === "issue") && (
                <div className="work-progress work-section-progress" aria-hidden>
                  <span style={{ width: `${progress(children.filter((i) => i.kind === "issue"))}%` }} />
                </div>
              )}
              <button
                className="work-text-button"
                onClick={() =>
                  onCreate(
                    "issue",
                    issue
                      ? {
                          parent: item.id,
                          team: item.data.team,
                          project: item.data.project,
                        }
                      : item.kind === "milestone"
                        ? { milestone: item.id, project: item.data.project }
                        : { project: item.id },
                  )
                }
              >
                <Icon name="plus" size={14} />
                Add task
              </button>
            </div>
            <IssueRows rows={children.filter((i) => i.kind === "issue")} items={items} actions={issueActions} showProject={item.kind === "initiative"} />
            {!children.some((i) => i.kind === "issue") && (
              <p className="work-muted">
                Break the work into smaller tasks your team can pick up.
              </p>
            )}
          </section>
        )}
        <section className="work-detail-section">
          <div className="work-section-title">
            <h2>Activity</h2>
            <button
              className="work-text-button"
              disabled={!actor || readOnly}
              onClick={() =>
                onPatch({
                  subscribers: item.data.subscribers?.includes(actor)
                    ? item.data.subscribers.filter((v) => v !== actor)
                    : [...(item.data.subscribers ?? []), actor],
                })
              }
            >
              <Icon name="bell" size={14} />
              {item.data.subscribers?.includes(actor)
                ? "Subscribed"
                : "Subscribe"}
            </button>
          </div>
          <div className="work-activity">
            {history.length > 12 && <button className="work-text-button" onClick={() => setShowAllHistory(v => !v)}>{showAllHistory ? "Show recent activity" : `Show ${history.length - 12} earlier events`}</button>}
            {(showAllHistory ? history : history.slice(-12)).map((e) => (
              <div
                className={`work-activity-item ${["comment", "update"].includes(e.type) ? "work-comment" : ""}`}
                key={e.id}
              >
                <Avatar small name={e.actor} />
                <div>
                  <div className="work-activity-meta">
                    <b>{e.actor}</b>
                    <span>
                      {new Date(e.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {["comment", "update", "reaction"].includes(e.type) ? (
                    <>
                      <RichText text={e.body} />
                      {e.type !== "reaction" && (
                        <button
                          className="work-text-button"
                          disabled={readOnly || posting}
                          onClick={() =>
                            onComment(`👍 ${e.actor}'s ${e.type}`, "reaction")
                          }
                        >
                          👍 React
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="work-muted">
                      {e.type === "status"
                        ? `set status to ${statusLabel(e.body)}`
                        : e.type === "updated"
                          ? describeUpdate(e, item, items)
                          : `${e.type} this ${KIND_NAMES[item.kind].toLowerCase()}`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form
            className="work-comment-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await onComment(comment, issue ? "comment" : "update"))
                setComment("");
            }}
          >
            <textarea
              className="input"
              aria-label="Comment"
              placeholder={
                issue
                  ? "Leave a comment… Use @name to mention someone."
                  : "Share a progress update…"
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              required
            />
            <div>
              <span className="work-muted">Markdown supported</span>
              <button
                className="btn btn-primary"
                disabled={readOnly || posting || !comment.trim()}
              >
                {posting ? "Posting…" : issue ? "Comment" : "Post update"}
              </button>
            </div>
          </form>
        </section>
      </div>
      <aside className="work-properties">
        <h2>Properties</h2>
        <Field label="Status">
          <PropertyPicker label="Status" value={item.data.status ?? "Planned"} disabled={readOnly} onChange={status => onPatch({status})}
            options={uniqueStatuses([item.data.status ?? "Planned", ...(issue ? STATUSES : ["Planned", "In progress", "Done", "Canceled"])]).map(s => ({value:s,label:statusLabel(s),icon:<StatusIcon status={s}/>}))}/>
        </Field>
        <Field label="Priority">
          <PropertyPicker label="Priority" value={String(item.data.priority ?? 0)} disabled={readOnly} onChange={v => onPatch({priority:Number(v)})} icon={<PriorityIcon priority={item.data.priority} size={15}/>} options={PRIORITIES.map((p,n) => ({value:String(n),label:p,icon:<PriorityIcon priority={n}/>}))}/>
        </Field>
        <Field label={issue ? "Assignee" : "Lead"}>
          <EntitySelect
                disabled={readOnly}
            kind="member"
            items={items}
            value={item.data.assignee}
            onChange={(v) => onPatch({ assignee: v })}
            empty="Unassigned"
          />
        </Field>
        <Field label="Labels"><LabelPicker item={item} items={items} disabled={readOnly} onChange={labels => onPatch({ labels })}/></Field>
        {issue && (
          <>
            <Field label="Project">
              <EntitySelect
                disabled={readOnly}
                kind="project"
                items={items}
                value={item.data.project}
                onChange={(v) => onPatch({ project: v, milestone: "" })}
              />
            </Field>
            <Field label="Milestone">
              <EntitySelect disabled={readOnly} kind="milestone" items={items.filter(i => i.kind !== "milestone" || i.data.project === item.data.project)} value={item.data.milestone} onChange={milestone => onPatch({milestone})}/>
            </Field>
            <Field label="Due date">
              <CommitInput
                className="input"
                type="date"
                aria-label="Due date"
                data-empty={!item.data.due}
                disabled={readOnly}
                value={item.data.due ?? ""}
                onCommit={(due) => onPatch({ due })}
              />
            </Field>
            <Field label="Estimate">
              <CommitInput
                className="input"
                type="number"
                min={0}
                max={100}
                step={1}
                aria-label="Estimate"
                disabled={readOnly}
                value={String(item.data.estimate ?? 0)}
                onCommit={(v) => onPatch({ estimate: Math.min(100, Math.max(0, Math.round(Number(v) || 0))) })}
              />
            </Field>
          </>
        )}
        {item.kind === "milestone" && <><Field label="Project"><EntitySelect disabled={readOnly} kind="project" items={items} value={item.data.project} onChange={project => onPatch({project})}/></Field><Field label="Target date"><CommitInput className="input" type="date" aria-label="Milestone target date" data-empty={!item.data.due} disabled={readOnly} value={item.data.due || ""} onCommit={due => onPatch({due})}/></Field></>}
        {!["issue", "document"].includes(item.kind) && (
          <div className="work-detail-progress">
            <div className="work-progress">
              <span
                style={{
                  width: `${item.kind === "milestone" ? milestoneProgress(item, items).percent : progress(children.filter((i) => i.kind === "issue"))}%`,
                }}
              />
            </div>
            <p>
              {item.kind === "milestone" ? milestoneProgress(item, items).percent : progress(children.filter((i) => i.kind === "issue"))}% progress
            </p>
          </div>
        )}
        {issue && (
          <details className="work-detail-section work-issue-relations">
            <summary>Relationships</summary>
            {(item.data.relations ?? []).map((r, n) => {
              const other = items.find((i) => i.id === r.id);
              return (
                <div className="work-relation" key={`${r.id}-${r.type}`}>
                  <span>{r.type}</span>
                  <button onClick={() => other && onOpen(other)}>
                    {other?.title ?? "Unavailable task"}
                  </button>
                  <button
                    className="work-icon-button"
                    aria-label="Remove relationship"
                    disabled={readOnly}
                    onClick={() =>
                      onPatch({
                        relations: item.data.relations?.filter(
                          (_, index) => index !== n,
                        ),
                      })
                    }
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              );
            })}
            {inverse.map((r) => (
              <div className="work-relation" key={r.id}>
                <span>{r.type}</span>
                <button
                  onClick={() => {
                    const i = items.find((i) => i.id === r.id);
                    if (i) onOpen(i);
                  }}
                >
                  {items.find((i) => i.id === r.id)?.title}
                </button>
              </div>
            ))}
            <select
              className="input"
              aria-label="Relationship type"
              value={relationType}
              onChange={(e) =>
                setRelationType(e.target.value as typeof relationType)
              }
            >
              {(issue
                ? ["related", "blocks", "blocked by", "duplicate of"]
                : ["related", "blocks", "blocked by"]
              ).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <EntitySelect
                disabled={readOnly}
              kind={issue ? "issue" : "project"}
              items={items}
              value={relationId}
              onChange={setRelationId}
              exclude={item.id}
              empty="Choose a task"
            />
            <button
              className="work-text-button"
              disabled={!relationId || readOnly}
              onClick={() => {
                onPatch({
                  relations: [
                    ...(item.data.relations ?? []),
                    { id: relationId, type: relationType },
                  ],
                  ...(relationType === "duplicate of"
                    ? { status: "Duplicate" }
                    : {}),
                });
                setRelationId("");
              }}
            >
              Add relationship
            </button>
          </details>
        )}
        <div className="work-detail-section work-danger-zone">
          <button
            className="work-text-button"
            disabled={readOnly}
            onClick={onArchive}
          >
            <Icon name="archive" size={15} />
            {item.archived ? "Restore from archive" : "Archive"}
          </button>
          <button
            className="work-text-button"
            disabled={readOnly}
            onClick={onDelete}
          >
            Move to trash
          </button>
        </div>
        {item.kind === "initiative" && (
          <button
            className="work-text-button"
            onClick={() =>
              onCreate("initiative", { parentInitiative: item.id })
            }
          >
            Add sub-initiative
          </button>
        )}
        <p className="work-muted work-created">
          Created {dateLabel(item.created_at)}
        </p>
      </aside>
    </div>
  );
}
