"use client";
import { useEffect, useState, type ReactNode } from "react";
import { filterIssues, type WorkData, type WorkFilter, type WorkItem } from "@/lib/work";
import { Empty, IssueBoard, IssueList } from "./collections";
import { IssueFilterFields, type FilterKey } from "./filter-fields";
import { Icon, statusLabel } from "./icons";
import type { IssueActions } from "./issue-menu";
import { PropertyPicker } from "./property-picker";

export type IssueView = { filter: WorkFilter; layout: "list" | "board"; group: string; sort: string };
export const DEFAULT_ISSUE_VIEW: IssueView = { filter: {}, layout: "list", group: "status", sort: "priority" };

const STATUS_TABS = ["In progress", "Todo", "Backlog", "Done"];
const SORTS: Record<string, string> = { priority: "Priority", created: "Newest", due: "Due date", title: "Title" };
const GROUPS: Record<string, string> = { status: "Status", project: "Project", none: "None" };
const BULK_STATUSES = ["Backlog", "Todo", "In progress", "In review", "Done", "Canceled"];

/**
 * The task browser: status tabs, search, filters, sort, grouping, list/board and bulk actions.
 * The Tasks pages and a project's Tasks tab both render this, so a change here shows up in both.
 */
export function IssueBrowser({
  items,
  scope,
  only,
  view,
  onView,
  actions,
  onCreate,
  hide = [],
  extraFilters,
  extraActive = 0,
  onClear,
  embedded = false,
  empty,
}: {
  items: WorkItem[];
  /** Filters this page always applies (a saved view, a project). The person's own filters go on top. */
  scope?: WorkFilter;
  /** A restriction filters can't express, such as "assigned to me" or "in this milestone". */
  only?: (issue: WorkItem) => boolean;
  view: IssueView;
  onView: (patch: Partial<IssueView>) => void;
  actions: IssueActions;
  onCreate: (preset: WorkData) => void;
  /** Filter fields that make no sense here, e.g. Project inside a project. */
  hide?: FilterKey[];
  extraFilters?: ReactNode;
  extraActive?: number;
  /** Runs with Clear, for state the caller owns (leaving a saved view, a milestone filter). */
  onClear?: () => void;
  /** Sits inside another page's padding instead of filling the workspace. */
  embedded?: boolean;
  /** What to say when there are no tasks at all (before filters). */
  empty?: { title: string; description: string };
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const readOnly = !!actions.disabled;
  const filter: WorkFilter = { ...scope, ...view.filter };
  const within = (list: WorkItem[]) => (only ? list.filter(only) : list);
  const statusBase = within(filterIssues(items, { ...filter, status: undefined }));
  const issues = within(filterIssues(items, filter)).sort((a, b) =>
    view.sort === "priority"
      ? (a.data.priority || 5) - (b.data.priority || 5)
      : view.sort === "due"
        ? (a.data.due || "9999").localeCompare(b.data.due || "9999")
        : view.sort === "title"
          ? a.title.localeCompare(b.title)
          : b.created_at.localeCompare(a.created_at),
  );
  const activeCount = Object.entries(filter).filter(([k, v]) => v && k !== "query" && !hide.includes(k as FilterKey)).length + extraActive;
  const filtersActive = activeCount > 0 || !!filter.query;
  // Only what is on screen can be acted on, so a filter change never bulk-edits hidden tasks.
  const chosen = issues.filter((i) => selected.includes(i.id));
  const hasSelection = chosen.length > 0;
  useEffect(() => {
    if (!hasSelection) return;
    function clear(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector("dialog[open], :popover-open, .work-context-menu")) setSelected([]);
    }
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, [hasSelection]);

  function updateFilter(patch: WorkFilter) {
    onView({ filter: { ...view.filter, ...patch } });
    setSelected([]);
  }
  function clearFilters() {
    onView({ filter: {} });
    onClear?.();
    setSelected([]);
  }
  function bulk(change: { data?: WorkData; archived?: boolean; deleted?: boolean }) {
    actions.onBulk(chosen, change);
    setSelected([]);
  }
  // A new task starts inside whatever is being looked at: the filtered team and project, plus the group it was added to.
  const create = (preset: WorkData = {}) =>
    onCreate({ ...(filter.team ? { team: filter.team } : {}), ...(filter.project ? { project: filter.project } : {}), ...preset });
  const members = items.filter((i) => i.kind === "member" && !i.archived && !i.deleted_at);

  return (
    <div className="work-issue-browser" data-embedded={embedded}>
      <div className="work-status-tabs" role="tablist" aria-label="Show tasks by status">
        {[{ value: "", label: "All", count: statusBase.length }, ...STATUS_TABS.map((st) => ({ value: st, label: statusLabel(st), count: statusBase.filter((i) => (i.data.status || "Backlog").toLowerCase() === st.toLowerCase()).length }))].map(({ value, label, count }) => (
          <button
            key={label}
            role="tab"
            aria-selected={(filter.status ?? "").toLowerCase() === value.toLowerCase()}
            onClick={() => updateFilter({ status: value })}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <div className="work-toolbar">
        <button
          className="work-control"
          data-active={filterOpen || activeCount > 0}
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((v) => !v)}
        >
          <Icon name="filter" size={15} />
          Filter
          <span className="work-filter-count">{activeCount || ""}</span>
        </button>
        <label className="work-search-field">
          <Icon name="search" size={15} />
          <input
            className="work-inline-search"
            aria-label="Search tasks"
            placeholder="Search tasks…"
            value={view.filter.query ?? ""}
            onChange={(e) => updateFilter({ query: e.target.value })}
          />
        </label>
        {filtersActive && (
          <button className="work-text-button" onClick={clearFilters}>
            Clear
          </button>
        )}
        <span className="work-toolbar-count">
          {issues.length} {issues.length === 1 ? "task" : "tasks"}
        </span>
        <div className="work-toolbar-right">
          <PropertyPicker label="Sort by" value={view.sort} onChange={(sort) => onView({ sort })} icon={<Icon name="filter" size={14} />} display={<>Sort: {SORTS[view.sort]}</>} options={Object.entries(SORTS).map(([value, label]) => ({ value, label }))} />
          {view.layout === "list" && (
            <PropertyPicker label="Group by" value={view.group} onChange={(group) => onView({ group })} display={<>Group: {GROUPS[view.group] ?? "Status"}</>} options={Object.entries(GROUPS).filter(([value]) => value !== "project" || !hide.includes("project")).map(([value, label]) => ({ value, label: value === "none" ? "No grouping" : label }))} />
          )}
          <div className="work-layout-toggle">
            <button aria-label="List layout" aria-pressed={view.layout === "list"} onClick={() => onView({ layout: "list" })}>
              <Icon name="issues" size={16} />
            </button>
            <button aria-label="Board layout" aria-pressed={view.layout === "board"} onClick={() => onView({ layout: "board" })}>
              <Icon name="board" size={16} />
            </button>
          </div>
        </div>
      </div>
      {filterOpen && (
        <div className="work-filter-panel">
          <IssueFilterFields items={items} filter={filter} onChange={updateFilter} hide={hide} />
          {extraFilters}
          <button className="work-text-button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}
      {hasSelection && (
        <div className="work-bulk">
          <b>{chosen.length} selected</b>
          <select
            className="work-control"
            aria-label="Bulk change status"
            value=""
            disabled={readOnly}
            onChange={(e) => bulk({ data: { status: e.target.value } })}
          >
            <option value="" disabled>
              Change status…
            </option>
            {BULK_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <select
            className="work-control"
            aria-label="Bulk assign"
            value=""
            disabled={readOnly}
            onChange={(e) => bulk({ data: { assignee: e.target.value === "none" ? "" : e.target.value } })}
          >
            <option value="" disabled>
              Assign to…
            </option>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
          <button className="work-text-button" disabled={readOnly} onClick={() => bulk({ archived: true })}>
            Archive
          </button>
          <button className="work-text-button danger" disabled={readOnly} onClick={() => bulk({ deleted: true })}>
            Move to trash
          </button>
          <button className="work-text-button" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      )}
      {!issues.length ? (
        <Empty
          title={filtersActive ? "No matching tasks" : empty?.title ?? "No tasks"}
          description={filtersActive ? "Try adjusting your filters or search." : empty?.description ?? "Create a task to get started."}
          // Full pages already have New task in their heading; only the embedded list needs its own.
          onCreate={readOnly || filtersActive || !embedded ? undefined : () => create()}
        />
      ) : view.layout === "board" ? (
        <IssueBoard rows={issues} items={items} issueActions={actions} onCreate={create} />
      ) : (
        <IssueList
          rows={issues}
          items={items}
          selected={selected}
          onSelect={(id) => setSelected((s) => (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]))}
          onCreate={create}
          issueActions={actions}
          group={view.group}
          showProject={!hide.includes("project")}
        />
      )}
    </div>
  );
}
