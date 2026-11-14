"use client";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  dateLabel,
  done,
  issueCode,
  PRIORITIES,
  progress,
  STATUSES,
  today,
  uniqueStatuses,
  type WorkData,
  type WorkItem,
  type WorkKind,
} from "@/lib/work";
import { useIssueMenu, type IssueActions } from "./issue-menu";
import { MultiPicker, PropertyPicker } from "./property-picker";
import { useItemMenuShow } from "./item-menu";
import { Icon, StatusIcon } from "./icons";
export function Labels({ item, items, byId }: { item: WorkItem; items: WorkItem[]; byId?: Map<string, WorkItem> }) {
  return (
    <span className="work-labels">
      {(item.data.labels ?? []).map((id) => {
        const label = byId ? byId.get(id) : items.find((i) => i.id === id);
        return label ? (
          <span className="work-chip" key={id}>
            <span
              className="work-color-dot"
              style={{ background: label.data.color || "var(--purple)" }}
            />
            {label.title}
          </span>
        ) : null;
      })}
    </span>
  );
}
/** Labels with a small checklist popover to add or remove them in place. */
export function LabelPicker({ item, items, disabled, onChange }: { item: WorkItem; items: WorkItem[]; disabled: boolean; onChange: (labels: string[]) => void }) {
  const all = items.filter(i => i.kind === "label" && !i.archived && !i.deleted_at);
  const valid = (item.data.labels ?? []).filter(id => all.some(l => l.id === id));
  return <span className="work-label-picker">
    <Labels item={item} items={items} />
    <MultiPicker label="Labels" disabled={disabled} values={valid} onChange={onChange} empty="Create labels in Settings → Labels"
      options={all.map(l => ({ value: l.id, label: l.title, color: l.data.color }))}>
      <Icon name="plus" size={14} /> {valid.length ? "Edit" : "Add label"}
    </MultiPicker>
  </span>;
}
export function Avatar({
  name,
  small = false,
}: {
  name?: string;
  small?: boolean;
}) {
  return (
    <span
      className={`work-avatar ${small ? "work-avatar-small" : ""}`}
      title={name || "Unassigned"}
    >
      {name ? (
        name
          .split(/\s+/)
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      ) : (
        <Icon name="member" size={13} />
      )}
    </span>
  );
}
export function Empty({
  title,
  description,
  onCreate,
  action = "Create task",
  icon = "issues",
}: {
  title: string;
  description: string;
  onCreate?: () => void;
  action?: string;
  icon?: string;
}) {
  return (
    <div className="work-empty">
      <div className="work-empty-art">
        <span />
        <span />
        <span />
        <div>
          <Icon name={icon} size={28} />
        </div>
      </div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {onCreate && (
        <button className="btn btn-primary" onClick={onCreate}>
          <Icon name="plus" size={16} />
          {action}
        </button>
      )}
    </div>
  );
}
/** Active work first, so the list opens on what people are doing now. */
const LIST_ORDER = uniqueStatuses(["In progress", "In review", "Todo", "Backlog", "Done", ...STATUSES]);
const PRIORITY_OPTIONS = PRIORITIES.map((p, n) => ({ value: String(n), label: p }));

/** Per-list lookups, built once so a long list doesn't search every item for every row. */
export type IssueLookup = {
  byId: Map<string, WorkItem>;
  statusOptions: { value: string; label: string; icon: ReactNode }[];
  /** Imported statuses differ only in capitalization; this maps any spelling to its option. */
  statusValue: Map<string, string>;
  memberOptions: { value: string; label: string }[];
  today: string;
};
export function useIssueLookup(items: WorkItem[]): IssueLookup {
  return useMemo(() => {
    const live = items.filter((i) => !i.archived && !i.deleted_at);
    const statuses = uniqueStatuses([
      ...STATUSES,
      ...live.flatMap((i) => (i.kind === "team" ? (i.data.workflow ?? []) : i.kind === "issue" && i.data.status ? [i.data.status] : [])),
    ]);
    return {
      byId: new Map(items.map((i) => [i.id, i])),
      statusOptions: statuses.map((s) => ({ value: s, label: s, icon: <StatusIcon status={s} /> })),
      statusValue: new Map(statuses.map((s) => [s.toLowerCase(), s])),
      memberOptions: [{ value: "", label: "Unassigned" }, ...live.filter((i) => i.kind === "member").map((m) => ({ value: m.id, label: m.title }))],
      today: today(),
    };
  }, [items]);
}

/**
 * The one task row. Every list of tasks (the Tasks page, a project's tasks, sub-tasks, a milestone's or
 * initiative's tasks) renders this, so status, priority and assignee can be changed in place everywhere.
 */
export function IssueRow({
  item,
  items,
  lookup,
  actions,
  onMenu,
  selected,
  onSelect,
  showProject = true,
  strikeDone = false,
}: {
  item: WorkItem;
  items: WorkItem[];
  lookup: IssueLookup;
  actions: IssueActions;
  onMenu: (item: WorkItem, e: MouseEvent<HTMLElement>) => void;
  selected?: boolean;
  /** Present only where tasks can be picked for bulk changes. */
  onSelect?: (id: string) => void;
  showProject?: boolean;
  /** Flat lists (sub-tasks) cross out finished work; grouped lists already have a Done section. */
  strikeDone?: boolean;
}) {
  const readOnly = !!actions.disabled;
  const status = item.data.status ?? "Backlog";
  const overdue = !!item.data.due && item.data.due < lookup.today && !done(item);
  return (
    <div
      className="work-issue-row"
      data-selected={!!selected}
      data-done={strikeDone && done(item)}
      onContextMenu={(e) => onMenu(item, e)}
    >
      {onSelect && (
        <input
          type="checkbox"
          aria-label={`Select ${item.title}`}
          checked={!!selected}
          onChange={() => onSelect(item.id)}
        />
      )}
      <div className="work-row-prop work-row-priority"><PropertyPicker label={`Priority for ${item.title}`} value={String(item.data.priority ?? 0)} disabled={readOnly} onChange={v => actions.onPatch(item, { priority: Number(v) })}
        display={<span className="work-priority" data-priority={item.data.priority}>{item.data.priority === 1 ? "!" : item.data.priority ? "▥" : "—"}</span>}
        options={PRIORITY_OPTIONS} /></div>
      <span className="work-code">{issueCode(item, lookup.byId)}</span>
      <div className="work-row-status-picker"><PropertyPicker label={`Status for ${item.title}`} value={lookup.statusValue.get(status.toLowerCase()) ?? status} disabled={readOnly} onChange={status => actions.onPatch(item, { status })}
        icon={<StatusIcon status={status} />} display={<span className="work-sr-only">{status}</span>} options={lookup.statusOptions} /></div>
      <button className="work-row-title" onClick={() => actions.onOpen(item)}>
        {item.title}
      </button>
      <Labels item={item} items={items} byId={lookup.byId} />
      {showProject && (
        <span className="work-row-project">
          {lookup.byId.get(item.data.project ?? "")?.title}
        </span>
      )}
      <span className="work-row-date" data-overdue={overdue} title={overdue ? "Overdue" : undefined}>
        {item.data.due && dateLabel(item.data.due)}
      </span>
      <div className="work-row-prop work-row-assignee"><PropertyPicker label={`Assignee for ${item.title}`} value={item.data.assignee ?? ""} disabled={readOnly} onChange={assignee => actions.onPatch(item, { assignee })}
        display={<Avatar small name={lookup.byId.get(item.data.assignee ?? "")?.title} />}
        options={lookup.memberOptions} /></div>
      <button className="work-icon-button work-row-more" aria-label={`More actions for ${item.title}`} aria-haspopup="menu" onClick={(e) => onMenu(item, e)}>
        <span aria-hidden>⋯</span>
      </button>
    </div>
  );
}

/** Task rows with no grouping or toolbar, for the short lists inside a task, milestone or initiative. */
export function IssueRows({
  rows,
  items,
  actions,
  showProject = false,
}: {
  rows: WorkItem[];
  items: WorkItem[];
  actions: IssueActions;
  showProject?: boolean;
}) {
  const lookup = useIssueLookup(items);
  const issueMenu = useIssueMenu(items, actions);
  return (
    <div className="work-issue-rows">
      {issueMenu.element}
      {rows.map((item) => (
        <IssueRow key={item.id} item={item} items={items} lookup={lookup} actions={actions} onMenu={issueMenu.show} showProject={showProject} strikeDone />
      ))}
    </div>
  );
}

export function IssueList({
  rows,
  items,
  selected,
  onSelect,
  onCreate,
  issueActions,
  group,
  showProject = true,
}: {
  rows: WorkItem[];
  items: WorkItem[];
  selected: string[];
  onSelect: (id: string) => void;
  /** Starts a new task already placed in the group whose + was pressed. */
  onCreate?: (preset: WorkData) => void;
  issueActions: IssueActions;
  group: string;
  showProject?: boolean;
}) {
  const lookup = useIssueLookup(items);
  const issueMenu = useIssueMenu(items, issueActions);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const chosen = new Set(selected);
  const buckets = new Map<string, { key: string; title: string; rows: WorkItem[]; preset: WorkData }>();
  if (group === "none") buckets.set("all", { key: "all", title: "All tasks", rows, preset: {} });
  else
    for (const i of rows) {
      const value = group === "project" ? (i.data.project ?? "") : (i.data.status ?? "Backlog");
      const key = value.toLowerCase();
      const bucket = buckets.get(key);
      if (bucket) bucket.rows.push(i);
      else
        buckets.set(key, group === "project"
          ? { key, title: lookup.byId.get(value)?.title ?? "No project", rows: [i], preset: value ? { project: value } : {} }
          : { key, title: LIST_ORDER.find((s) => s.toLowerCase() === key) ?? value, rows: [i], preset: { status: LIST_ORDER.find((s) => s.toLowerCase() === key) ?? value } });
    }
  const rank = (key: string) => {
    const n = LIST_ORDER.findIndex((s) => s.toLowerCase() === key);
    return n < 0 ? LIST_ORDER.length : n;
  };
  const groups = [...buckets.values()];
  if (group === "status") groups.sort((a, b) => rank(a.key) - rank(b.key));
  return (
    <div className="work-list">
      {issueMenu.element}
      {groups.map((g) => {
        const closed = collapsed.includes(g.key);
        const all = g.rows.every((i) => chosen.has(i.id));
        return (
          <section key={g.key}>
            <div className="work-group-heading">
              <input type="checkbox" className="work-group-select" aria-label={`Select all ${g.title} tasks`} checked={all} ref={input => { if(input) input.indeterminate = !all && g.rows.some(i => chosen.has(i.id)); }} onChange={e => { const checked = e.target.checked; g.rows.filter(i => chosen.has(i.id) !== checked).forEach(i => onSelect(i.id)); }}/>
              <h3>
                <button className="work-group-toggle" aria-expanded={!closed} onClick={() => setCollapsed((c) => (closed ? c.filter((k) => k !== g.key) : [...c, g.key]))}>
                  <span className="work-group-caret" data-closed={closed} aria-hidden>▾</span>
                  {group === "status" && <StatusIcon status={g.title} />}
                  {g.title}
                  <span className="work-group-count">{g.rows.length}</span>
                </button>
              </h3>
              {onCreate && !issueActions.disabled && (
                <button className="work-icon-button" aria-label={`Add task to ${g.title}`} onClick={() => onCreate(g.preset)}>
                  <Icon name="plus" size={15} />
                </button>
              )}
            </div>
            {!closed && g.rows.map((item) => (
              <IssueRow key={item.id} item={item} items={items} lookup={lookup} actions={issueActions} onMenu={issueMenu.show} selected={chosen.has(item.id)} onSelect={onSelect} showProject={showProject} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
export function IssueBoard({
  rows,
  items,
  onCreate,
  issueActions,
}: {
  rows: WorkItem[];
  items: WorkItem[];
  onCreate: (preset: WorkData) => void;
  issueActions: IssueActions;
}) {
  const lookup = useIssueLookup(items);
  const issueMenu = useIssueMenu(items, issueActions);
  const readOnly = !!issueActions.disabled;
  const statuses = uniqueStatuses(["Backlog", "Todo", "In progress", "In review", "Done", ...rows.map(i => i.data.status ?? "Backlog")]);
  return (
    <div className="work-board">
      {issueMenu.element}
      {statuses.map((status) => {
        const list = rows.filter(
          (i) => (i.data.status ?? "Backlog").toLowerCase() === status.toLowerCase(),
        );
        return (
          <section
            className="work-board-column"
            key={status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const item = rows.find(
                (i) => i.id === e.dataTransfer.getData("text/plain"),
              );
              if (item && !readOnly && (item.data.status ?? "Backlog").toLowerCase() !== status.toLowerCase()) issueActions.onPatch(item, { status });
            }}
          >
            <div className="work-group-heading">
              <StatusIcon status={status} />
              <h3>{status}</h3>
              <span>{list.length}</span>
              {!readOnly && (
                <button
                  className="work-icon-button"
                  aria-label={`Add task to ${status}`}
                  onClick={() => onCreate({ status })}
                >
                  <Icon name="plus" size={15} />
                </button>
              )}
            </div>
            <div className="work-board-cards">
              {list.map((item) => (
                <button
                  className="work-issue-card"
                  key={item.id}
                  draggable={!readOnly}
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", item.id)
                  }
                  onClick={() => issueActions.onOpen(item)}
                  onContextMenu={(e) => issueMenu.show(item, e)}
                >
                  <span className="work-code">{issueCode(item, lookup.byId)}</span>
                  <h3>{item.title}</h3>
                  <Labels item={item} items={items} byId={lookup.byId} />
                  <div className="work-card-foot">
                    <span
                      className="work-priority"
                      data-priority={item.data.priority}
                    >
                      {PRIORITIES[item.data.priority ?? 0]}
                    </span>
                    <span data-overdue={!!item.data.due && item.data.due < lookup.today && !done(item)}>{item.data.due && dateLabel(item.data.due)}</span>
                    <Avatar
                      small
                      name={lookup.byId.get(item.data.assignee ?? "")?.title}
                    />
                  </div>
                </button>
              ))}
              {!readOnly && (
                <button
                  className="work-board-add"
                  onClick={() => onCreate({ status })}
                >
                  <Icon name="plus" size={14} />
                  Add task
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
export function Collection({
  rows,
  items,
  kind,
  onOpen,
  onCreate,
  onPreview,
}: {
  onPreview?: (item: WorkItem) => void;
  rows: WorkItem[];
  items: WorkItem[];
  kind: WorkKind;
  onOpen: (item: WorkItem) => void;
  onCreate: () => void;
}) {
  const menuFor = useItemMenuShow();
  if (!rows.length)
    return (
      <Empty
        title={`No ${kind === "initiative" ? "initiatives" : kind + "s"}`}
        description=""
        onCreate={onCreate}
        action={`Create ${kind}`}
        icon={kind + "s"}
      />
    );
  return (
    <div className="work-collection">
      {rows.map((item) => {
        const projects = items.filter(
          (i) =>
            i.kind === "project" &&
            i.data.initiative === item.id &&
            !i.deleted_at &&
            !i.archived,
        );
        const children = items.filter(
          (i) =>
            i.kind === "issue" &&
            !i.deleted_at &&
            !i.archived &&
            (kind === "initiative"
              ? projects.some((p) => p.id === i.data.project)
              : kind === "project"
                ? i.data.project === item.id
                : kind === "milestone"
                  ? i.data.milestone === item.id
                  : false),
        );
        const pct = progress(children);
        const doing = children.filter((i) => ["in progress", "in review"].includes((i.data.status ?? "").toLowerCase())).length;
        const doneCount = children.filter(done).length;
        const next = children
          .filter((i) => !done(i))
          .sort((a, b) => (a.data.priority || 5) - (b.data.priority || 5))[0];
        const lead = items.find((i) => i.id === item.data.assignee)?.title;
        return (
          <button
            className="work-project-card"
            key={item.id}
            onContextMenu={menuFor(item)}
            onClick={() => onPreview && item.kind === "project" ? onPreview(item) : onOpen(item)}
            onDoubleClick={() => { if (onPreview && item.kind === "project") onOpen(item); }}
          >
            <div className="work-project-top">
              <span
                className="work-project-icon"
                style={{ color: item.data.color ?? "var(--purple)" }}
              >
                <Icon name={kind === "project" && item.data.icon ? item.data.icon : kind + "s"} size={22} />
              </span>
              <span className="work-chip">
                {item.data.status ||
                  (kind === "document" ? "Document" : "Planned")}
              </span>
              <Icon name="arrow" size={16} />
            </div>
            <h3>{item.title}</h3>
            {item.data.description && <p>{item.data.description.replace(/[#*`]/g, "").slice(0, 150)}</p>}
            {[
              "project",
              "initiative",
              "milestone",
            ].includes(kind) && (
              <div className="work-card-progress">
                <div className="work-card-progress-head">
                  <b>{pct}% complete</b>
                  <span>
                    {doneCount} of {children.length} tasks done
                  </span>
                </div>
                <div className="work-progress work-progress-split" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                  <span data-doing style={{ width: `${children.length ? (100 * doing) / children.length : 0}%` }} />
                </div>
                <div className="work-card-legend">
                  <span data-tone="good">{doneCount} done</span>
                  <span data-tone="warn">{doing} in progress</span>
                  <span data-tone="muted">{children.length - doneCount - doing} not started</span>
                </div>
              </div>
            )}
            {kind === "project" && (lead || next) && (
              <div className="work-card-meta">
                {lead && (
                  <span>
                    Lead <Avatar small name={lead} /> <b>{lead}</b>
                  </span>
                )}
                {next && (
                  <span className="work-card-next">
                    Next up: <b>{next.title}</b>
                  </span>
                )}
              </div>
            )}
            <div className="work-card-foot">
              <span>
                {item.data.health && (
                  <span className="work-health" data-health={item.data.health}>
                    {item.data.health}
                  </span>
                )}
                {item.data.start && `${dateLabel(item.data.start)} – `}
                {item.data.due && dateLabel(item.data.due)}
              </span>
              <Avatar
                small
                name={items.find((i) => i.id === item.data.assignee)?.title}
              />
            </div>
            {kind === "initiative" && (
              <span className="work-muted">{projects.length} projects</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
