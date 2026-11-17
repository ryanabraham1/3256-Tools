"use client";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { done, type WorkData, type WorkItem } from "@/lib/work";
import { Icon } from "./icons";

export type MilestoneActions = {
  onSave: (milestone: WorkItem, changes: { title?: string; data?: WorkData }) => void;
  onTrash: (milestone: WorkItem) => void;
  onOpen: (milestone: WorkItem) => void;
  /** Adds a milestone to a project; resolves false when the server refuses it. */
  onAdd?: (project: string, title: string, due: string) => Promise<boolean>;
  disabled?: boolean;
};

/** Right-click / ⋯ menu plus a small edit popover for a milestone, shared by the project sidebar and the timeline. */
export function useMilestoneMenu(actions: MilestoneActions) {
  const [menu, setMenu] = useState<{ milestone: WorkItem; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ milestone: WorkItem; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);

  /** Opens the menu at the pointer (right-click) or under the trigger (keyboard / ⋯ button). */
  function show(milestone: WorkItem, e: MouseEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const fromPointer = e.type === "contextmenu" && (e.clientX || e.clientY);
    const x = fromPointer ? e.clientX : r.left;
    const y = fromPointer ? e.clientY : r.bottom + 4;
    setMenu({ milestone, x: Math.max(8, Math.min(x, window.innerWidth - 220)), y: Math.max(8, Math.min(y, window.innerHeight - 240)) });
  }

  /** Opens the menu under a DOM element, for entries chosen from a picker. */
  function showBelow(milestone: WorkItem, anchor: Element | null) {
    const r = anchor?.getBoundingClientRect();
    const x = r ? r.left + 12 : window.innerWidth / 2;
    const y = r ? r.bottom + 4 : window.innerHeight / 3;
    setMenu({ milestone, x: Math.max(8, Math.min(x, window.innerWidth - 220)), y: Math.max(8, Math.min(y, window.innerHeight - 240)) });
  }

  const readOnly = !!actions.disabled;
  const run = (fn: () => void) => { setMenu(null); fn(); };
  const m = menu?.milestone;
  const complete = m ? done(m) : false;

  const element: ReactNode = <>
    {menu && m && <div ref={ref} className="work-context-menu" role="menu" aria-label={`${m.title} actions`} style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
        e.preventDefault();
        const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}>
      <button role="menuitem" onClick={() => run(() => actions.onOpen(m))}><Icon name="arrow" size={14} />Open milestone</button>
      <button role="menuitem" disabled={readOnly} onClick={() => run(() => setEditing({ milestone: m, x: menu.x, y: menu.y }))}><Icon name="edit" size={14} />Edit name &amp; date…</button>
      <button role="menuitem" disabled={readOnly} onClick={() => run(() => actions.onSave(m, { data: { status: complete ? "Planned" : "Done" } }))}><Icon name="check" size={14} />{complete ? "Reopen milestone" : "Mark as completed"}</button>
      {m.data.due && <button role="menuitem" disabled={readOnly} onClick={() => run(() => actions.onSave(m, { data: { due: "" } }))}><Icon name="close" size={14} />Clear target date</button>}
      <hr />
      <button role="menuitem" className="danger" disabled={readOnly} onClick={() => run(() => actions.onTrash(m))}><Icon name="trash" size={14} />Delete milestone</button>
    </div>}
    {editing && <MilestonePopover key={editing.milestone.id} milestone={editing.milestone} x={editing.x} y={editing.y} disabled={readOnly} onClose={() => setEditing(null)} onSave={(title, due) => {
      actions.onSave(editing.milestone, { title, data: { due } });
      setEditing(null);
    }} onTrash={() => { actions.onTrash(editing.milestone); setEditing(null); }} />}
  </>;

  return { show, showBelow, element };
}

/** Edits a milestone's name and date in a small card where its menu was, not a full-screen dialog. */
function MilestonePopover({ milestone, x, y, disabled, onClose, onSave, onTrash }: {
  milestone: WorkItem; x: number; y: number; disabled: boolean; onClose: () => void; onSave: (title: string, due: string) => void; onTrash: () => void;
}) {
  const [title, setTitle] = useState(milestone.title);
  const [due, setDue] = useState(milestone.data.due || "");
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>("input")?.select(); }, []);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [onClose]);
  return <form ref={ref} className="work-popover work-milestone-form" aria-label="Edit milestone"
    style={{ left: Math.max(8, Math.min(x, window.innerWidth - 328)), top: Math.max(8, Math.min(y, window.innerHeight - 230)) }}
    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    onSubmit={e => { e.preventDefault(); if (title.trim()) onSave(title.trim(), due); }}>
    <label>Name<input className="input" required aria-label="Milestone name" value={title} disabled={disabled} onChange={e => setTitle(e.target.value)} /></label>
    <label>Target date<span className="work-milestone-form-date"><input className="input" type="date" aria-label="Milestone target date" value={due} disabled={disabled} onChange={e => setDue(e.target.value)} />{due && <button type="button" className="work-text-button" onClick={() => setDue("")}>Clear</button>}</span></label>
    <div className="work-milestone-form-actions">
      {confirming
        ? <><span className="work-muted">Move to trash?</span><button type="button" className="work-text-button" onClick={() => setConfirming(false)}>Keep</button><button type="button" className="btn btn-danger" onClick={onTrash}>Delete</button></>
        : <><button type="button" className="work-text-button" disabled={disabled} onClick={() => setConfirming(true)}>Delete</button><button type="button" className="work-text-button" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={disabled || !title.trim()}>Save</button></>}
    </div>
  </form>;
}

/** Adds milestones right inside the project's Milestones card: type a name, optionally a date, press Enter. */
export function MilestoneAdd({ onAdd, onClose }: { onAdd: (title: string, due: string) => Promise<boolean>; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <form className="work-milestone-add" aria-label="Add milestone"
    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    onSubmit={async e => {
      e.preventDefault();
      if (!title.trim() || saving) return;
      setSaving(true);
      const ok = await onAdd(title.trim(), due);
      setSaving(false);
      // Stays open for the next one, the way adding stages usually goes.
      if (ok) { setTitle(""); setDue(""); input.current?.focus(); }
    }}>
    <input ref={input} className="input" aria-label="Milestone name" placeholder="Milestone name" value={title} onChange={e => setTitle(e.target.value)} />
    <div>
      <input className="input" type="date" aria-label="Milestone target date" value={due} onChange={e => setDue(e.target.value)} />
      <button type="button" className="work-text-button" onClick={onClose}>Done</button>
      <button className="btn btn-primary" disabled={saving || !title.trim()}>{saving ? "Adding…" : "Add"}</button>
    </div>
  </form>;
}
