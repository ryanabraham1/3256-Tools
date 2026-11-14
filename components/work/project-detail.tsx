"use client";
import { useRef, useState } from "react";
import { deleteWorkUpdate, editWorkUpdate } from "@/app/work-actions";
import { useWork } from "./work-provider";
import { activeWorkItems, dateLabel, today, done, milestoneProgress, uniqueStatuses, PRIORITIES, progress, type WorkData, type WorkEvent, type WorkItem, type WorkKind } from "@/lib/work";
import { Avatar, LabelPicker, Labels, Empty } from "./collections";
import { DEFAULT_ISSUE_VIEW, IssueBrowser, type IssueView } from "./issue-browser";
import { RichText } from "./detail";
import { CommitInput, EntitySelect, Field, Modal } from "./editor";
import { Icon, MilestoneIcon, PROJECT_ICONS, StatusIcon } from "./icons";
import type { IssueActions } from "./issue-menu";
import { useItemMenuShow } from "./item-menu";
import { useMilestoneMenu, type MilestoneActions } from "./milestone-menu";
import { InlineEdit, PropertyPicker } from "./property-picker";

const PROJECT_COLORS = ["#6b3fd4", "#2b69b6", "#178558", "#b86a04", "#cf3e4c", "#c2418f", "#0e8f9f", "#5f6b7a"];
function ProjectEmblemPicker({ icon, color, disabled, onChange }: { icon?: string; color?: string; disabled: boolean; onChange: (data: WorkData) => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const current = color || "#6b3fd4";
  const [pos, setPos] = useState({ left: 0, top: 0 });
  return <div className="work-emblem-picker">
    <button type="button" className="work-project-emblem" aria-label="Change project icon and color" disabled={disabled} style={{ color: current }} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 284)), top: r.bottom + 8 }); menu.current?.togglePopover(); }}><Icon name={icon || "projects"} size={30} /></button>
    <div ref={menu} popover="auto" className="work-emblem-menu" style={pos} role="dialog" aria-label="Project icon and color">
      <div className="work-emblem-grid">{PROJECT_ICONS.map(n => <button type="button" key={n} aria-label={n} aria-pressed={(icon || "projects") === n} style={{ color: current }} onClick={() => onChange({ icon: n })}><Icon name={n} size={20} /></button>)}</div>
      <div className="work-emblem-colors">{PROJECT_COLORS.map(c => <button type="button" key={c} aria-label={`Color ${c}`} aria-pressed={current.toLowerCase() === c} style={{ background: c }} onClick={() => onChange({ color: c })} />)}<input type="color" aria-label="Custom color" value={current} onChange={e => onChange({ color: e.target.value })} /></div>
    </div>
  </div>;
}
function healthLabel(health: string) { return ({offTrack:"Off track", atRisk:"At risk", onTrack:"On track"} as Record<string,string>)[health] || health; }

type Tab = "Overview" | "Activity" | "Issues" | "Updates";
export function ProjectDetail({ item, items, events, readOnly, posting, onEdit, onPatch, onComment, onOpen, onCreate, onArchive, onDelete, milestoneActions, issueActions, preview = false }: {
  preview?: boolean;
  milestoneActions: MilestoneActions;
  issueActions: IssueActions;
  item: WorkItem; items: WorkItem[]; events: WorkEvent[]; readOnly: boolean; posting: boolean;
  onEdit: () => void; onPatch: (data: WorkData) => void;
  onComment: (body: string, type?: string) => Promise<boolean>;
  onOpen: (item: WorkItem) => void; onCreate: (kind: WorkKind, preset?: WorkData) => void;
  onArchive: () => void; onDelete: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Overview");
  const milestoneMenu = useMilestoneMenu(milestoneActions);
  const menuFor = useItemMenuShow();
  const [composer, setComposer] = useState(false);
  const { user } = useWork();
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState("");
  async function runUpdate(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setUpdateError("");
    const r = await fn();
    if (!r.ok) { setUpdateError(r.error ?? "Couldn't save. Please try again."); return; }
    // The action re-reads the workspace itself; no second refresh needed.
    setEditing(null); setDeleting(null);
  }
  const [body, setBody] = useState("");
  const [view, setView] = useState<IssueView>(DEFAULT_ISSUE_VIEW);
  const [milestone, setMilestone] = useState("");
  const [showProperties, setShowProperties] = useState(true);
  const live = activeWorkItems(items);
  const issues = live.filter(i => i.kind === "issue" && i.data.project === item.id);
  const milestones = live.filter(i => i.kind === "milestone" && i.data.project === item.id).sort((a,b) => (a.data.due || "9999").localeCompare(b.data.due || "9999"));
  const history = events.filter(e => e.item_id === item.id).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const updates = history.filter(e => e.type === "update");
  const documents = live.filter(i => i.kind === "document" && i.data.project === item.id);
  const pct = progress(issues);
  function updateCard(e: WorkEvent) {
    const canManage = e.type === "update" && user.role !== "viewer" && (user.role === "admin" || e.actor_id === user.memberId);
    const isEditing = editing?.id === e.id;
    return <article className="work-project-update" key={e.id}>
      <div className="work-project-update-meta"><Avatar small name={e.actor} /><b>{e.actor}</b><span>{dateLabel(e.created_at)}</span>
        {canManage && !isEditing && (deleting === e.id
          ? <span className="work-update-actions"><span className="work-muted">Delete this update?</span><button type="button" className="work-text-button" onClick={() => setDeleting(null)}>Keep</button><button type="button" className="work-text-button danger" disabled={readOnly} onClick={() => runUpdate(() => deleteWorkUpdate(e.id))}>Delete</button></span>
          : <span className="work-update-actions"><button type="button" className="work-text-button" onClick={() => { setUpdateError(""); setEditing({ id: e.id, body: e.body }); }}>Edit</button><button type="button" className="work-text-button" onClick={() => setDeleting(e.id)}>Delete</button></span>)}
      </div>
      {typeof e.data.health === "string" && <span className="work-health" data-health={healthLabel(e.data.health)}>{healthLabel(e.data.health)}</span>}
      {isEditing
        ? <form className="work-update-composer" onSubmit={ev => { ev.preventDefault(); runUpdate(() => editWorkUpdate(e.id, editing.body)); }}><textarea autoFocus className="input" aria-label="Edit update" rows={6} required value={editing.body} onChange={ev => setEditing({ id: e.id, body: ev.target.value })} /><div><button type="button" className="work-text-button" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" disabled={!editing.body.trim()}>Save</button></div></form>
        : <RichText text={e.body} />}
      {updateError && (isEditing || deleting === e.id) && <p className="work-error" role="alert">{updateError}</p>}
    </article>;
  }
  function milestoneRows() {
    return milestones.map(m => {
      const status = milestoneProgress(m, issues);
      const overdue = !status.complete && !!m.data.due && m.data.due < today();
      return <div key={m.id} className="work-milestone-entry" onContextMenu={e => milestoneMenu.show(m, e)}><button className="work-milestone-row" onClick={() => { if (preview) onOpen(m); else { setMilestone(m.id); setTab("Issues"); } }} title={`${m.title}: ${status.completed}/${status.total} completed. Click to view tasks.`}>
        <MilestoneIcon percent={status.percent} complete={status.complete} overdue={overdue} />
        <span className="work-milestone-name"><b>{m.title}</b><small>{status.percent}%</small></span>
        <span className="work-milestone-date" data-overdue={overdue}>{dateLabel(m.data.due)}</span>
      </button><button className="work-icon-button" aria-label={`Milestone actions for ${m.title}`} aria-haspopup="menu" onClick={e => milestoneMenu.show(m, e)}><Icon name="menu" size={13}/></button></div>;
    });
  }
  return <div className="work-project-detail" data-preview={preview}>
    {!preview && <nav className="work-project-tabs" aria-label="Project views">
      {(["Overview", "Activity", "Issues", "Updates"] as Tab[]).map(t => <button key={t} aria-current={tab === t ? "page" : undefined} data-active={tab === t} onClick={() => setTab(t)}>{t === "Issues" ? "Tasks" : t}{t === "Issues" && <span>{issues.length}</span>}</button>)}
      <div className="work-project-tab-actions">
        <button className="work-text-button" disabled={readOnly} onClick={() => setComposer(true)}><Icon name="updates" size={15} /> Write update</button>
        <button className="work-icon-button" aria-label="Toggle project details" aria-pressed={showProperties} onClick={() => setShowProperties(v => !v)}><Icon name="sidebar" size={17} /></button>
      </div>
    </nav>}
    <div className="work-project-columns" data-sidebar={showProperties}>
      {!preview && <main className="work-project-content" data-tab={tab}>
        {tab === "Overview" && <>
          <div className="work-project-heading"><ProjectEmblemPicker icon={item.data.icon} color={item.data.color} disabled={readOnly} onChange={onPatch} /><button className="work-text-button" onClick={onEdit}>Edit project</button></div>
          <InlineEdit label="Project name" value={item.title} disabled={readOnly} onSave={title => milestoneActions.onSave(item, { title })}><h1>{item.title}</h1></InlineEdit>
          <InlineEdit label="Summary" multiline value={item.data.description ?? ""} disabled={readOnly} placeholder="Add a short summary…" onSave={description => onPatch({ description })}>{item.data.description ? <RichText text={item.data.description} /> : <span className="work-description-placeholder">Add a short summary…</span>}</InlineEdit>
          <div className="work-project-inline-properties"><StatusIcon status={item.data.status} /><span>{item.data.status || "Planned"}</span><span className="work-priority" data-priority={item.data.priority}>{PRIORITIES[item.data.priority ?? 0]}</span><Avatar small name={items.find(i => i.id === item.data.assignee)?.title} /><span>{dateLabel(item.data.start)} → {dateLabel(item.data.due)}</span></div>
          <Labels item={item} items={items} />
          <section className="work-project-resources"><div className="work-section-title"><h2>Resources</h2><button className="work-text-button" disabled={readOnly} onClick={() => onCreate("document", { project: item.id })}><Icon name="plus" size={14} /> Add document</button></div>
            {item.data.url && <a className="work-reference" href={item.data.url} target="_blank" rel="noreferrer"><Icon name="link" size={14} />{item.data.url}</a>}
            {item.data.attachments?.map(a => <a className="work-reference" key={a.id} href={a.url} target="_blank" rel="noreferrer"><Icon name="link" size={14} />{a.title}</a>)}
            {documents.map(d => <button className="work-child" key={d.id} onClick={() => onOpen(d)} onContextMenu={menuFor(d)}><Icon name="documents" size={15}/>{d.title}</button>)}
            {!documents.length && !item.data.url && !item.data.attachments?.length && <p className="work-muted">Keep project documents and links here.</p>}
          </section>
          <section className="work-project-latest"><div className="work-section-title"><h2>Latest update</h2><button className="work-text-button" onClick={() => setComposer(true)} disabled={readOnly}><Icon name="updates" size={14} /> Update</button></div>
            
            {updates[0] ? updateCard(updates[0]) : <p className="work-muted">Share the latest progress with your team.</p>}
            {updates.length > 1 && <button className="work-text-button" onClick={() => setTab("Updates")}>View all {updates.length} updates <Icon name="arrow" size={14} /></button>}
          </section>
        </>}
        {tab === "Issues" && <>
          <div className="work-section-title"><h2>Tasks <span>{issues.length}</span></h2><button className="work-text-button" disabled={readOnly} onClick={() => onCreate("issue", { project: item.id, team: item.data.team, ...(milestone ? { milestone } : {}) })}><Icon name="plus" size={14}/> Add task</button></div>
          {/* The same browser as the Tasks page, scoped to this project. */}
          <IssueBrowser embedded items={items} scope={{ project: item.id }} only={milestone ? i => i.data.milestone === milestone : undefined}
            view={view} onView={patch => setView(v => ({ ...v, ...patch }))} actions={issueActions} hide={["team", "project"]}
            extraActive={milestone ? 1 : 0} onClear={() => setMilestone("")}
            extraFilters={<Field label="Milestone"><PropertyPicker label="Milestone filter" value={milestone} onChange={setMilestone} icon={<Icon name="timeline" size={15} />} options={[{ value: "", label: "All milestones" }, ...milestones.map(m => ({ value: m.id, label: m.title }))]} /></Field>}
            onCreate={preset => onCreate("issue", { project: item.id, team: item.data.team, ...(milestone ? { milestone } : {}), ...preset })} />
        </>}
        {tab === "Updates" && <><div className="work-section-title"><h2>Project updates</h2><button className="work-text-button" onClick={() => setComposer(true)} disabled={readOnly}>Write update</button></div>{updates.map(updateCard)}{!updates.length && <Empty title="No updates yet" description="Share a progress update with your team." />}</>}
        {tab === "Activity" && <><div className="work-section-title"><h2>Activity</h2></div>{history.map(e => ["update", "comment"].includes(e.type) ? updateCard(e) : <div className="work-project-event" key={e.id}><Avatar small name={e.actor}/><span><b>{e.actor}</b> {e.type === "status" ? `changed status to ${e.body}` : `${e.type} this project`}</span><time>{dateLabel(e.created_at)}</time></div>)}{!history.length && <Empty title="No activity yet" description="Project changes will appear here." />}</>}
      </main>}
      {showProperties && <aside className="work-project-sidebar">
        <section className="work-project-property-card"><h2>Properties</h2>
          <Field label="Status"><PropertyPicker label="Status" value={item.data.status || "Planned"} disabled={readOnly} onChange={status => onPatch({ status })} options={uniqueStatuses([item.data.status || "Planned", "Planned", "In progress", "Done", "Canceled"]).map(s => ({ value: s, label: s, icon: <StatusIcon status={s}/> }))}/></Field>
          <Field label="Priority"><PropertyPicker label="Priority" value={String(item.data.priority ?? 0)} disabled={readOnly} onChange={v => onPatch({ priority: Number(v) })} icon={<Icon name="insights" size={15}/>} options={PRIORITIES.map((p,n) => ({value:String(n),label:p}))}/></Field>
          <Field label="Lead"><EntitySelect disabled={readOnly} kind="member" items={items} value={item.data.assignee} onChange={assignee => onPatch({assignee})} empty="Assign lead" /></Field>
          <Field label="Start"><CommitInput className="work-inline-date" type="date" aria-label="Project start date" data-empty={!item.data.start} disabled={readOnly} value={item.data.start || ""} onCommit={start => onPatch({start})}/></Field>
          <Field label="Target"><CommitInput className="work-inline-date" type="date" aria-label="Project target date" data-empty={!item.data.due} disabled={readOnly} value={item.data.due || ""} onCommit={due => onPatch({due})}/></Field>
          <Field label="Team"><EntitySelect disabled={readOnly} kind="team" items={items} value={item.data.team} onChange={team => onPatch({team})}/></Field>
          <Field label="Initiative"><EntitySelect disabled={readOnly} kind="initiative" items={items} value={item.data.initiative} onChange={initiative => onPatch({initiative})}/></Field>
          <Field label="Labels"><div className="work-project-label-controls"><LabelPicker item={item} items={items} disabled={readOnly} onChange={labels => onPatch({ labels })}/></div></Field>
        </section>
        <section className="work-project-property-card"><div className="work-section-title"><h2>Milestones</h2><button className="work-icon-button" aria-label="Add milestone" disabled={readOnly} onClick={() => onCreate("milestone", {project:item.id})}><Icon name="plus" size={15}/></button></div>
          {milestoneRows()}{!milestones.length && <p className="work-muted">Add milestones to track project stages.</p>}

        </section>
        <section className="work-project-property-card"><div className="work-section-title"><h2>Progress</h2><b>{pct}%</b></div><div className="work-progress"><span style={{width:`${pct}%`}}/></div><p className="work-muted">{issues.filter(done).length} of {issues.length} issues completed</p></section>
        <details className="work-project-manage"><summary>Manage project</summary><button className="work-text-button" disabled={readOnly} onClick={onArchive}>{item.archived ? "Restore from archive" : "Archive project"}</button><button className="work-text-button" disabled={readOnly} onClick={onDelete}>Move to trash</button></details>
      </aside>}
    </div>
    {milestoneMenu.element}
    {composer && <Modal title="Project update" onClose={() => setComposer(false)}><form className="work-update-composer" onSubmit={async e => { e.preventDefault(); if (await onComment(body, "update")) { setBody(""); setComposer(false); } }}><h2>{item.title}</h2><textarea data-autofocus className="input" aria-label="Project update" placeholder="Share progress, blockers, and next steps…" rows={8} required value={body} onChange={e => setBody(e.target.value)}/><div><span className="work-muted">Markdown supported</span><button className="btn btn-primary" disabled={posting || !body.trim()}>{posting ? "Posting…" : "Post update"}</button></div></form></Modal>}
  </div>;
}
