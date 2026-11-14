"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { addPitItems, archivePitItem, deletePitEvent, movePitItem, patchPitItem, savePitEvent, savePitItem, setActivePitEvent } from "@/app/pit-actions";
import { PHASES, PHASE_LABEL, type Phase, type PitEvent, type PitItem } from "@/lib/pit";
import { fmtDate } from "@/lib/format";
import { ConfirmButton } from "./confirm-button";
import { ErrorText, Field, SubmitButton, useFabAction } from "./fab-ui";
import { PitImport } from "./pit-import";
import { Sheet } from "./sheet";

type Op =
  | { kind: "add"; items: PitItem[] }
  | { kind: "patch"; ids: string[]; patch: Partial<PitItem> }
  | { kind: "archive"; ids: string[]; archived: boolean };

function applyOp(items: PitItem[], op: Op): PitItem[] {
  if (op.kind === "add") return [...items, ...op.items];
  const hit = new Set(op.ids);
  if (op.kind === "patch") return items.map((i) => (hit.has(i.id) ? { ...i, ...op.patch } : i));
  const at = op.archived ? new Date().toISOString() : null;
  return items.map((i) => (hit.has(i.id) ? { ...i, archived_at: at } : i));
}

const isTemp = (id: string) => id.startsWith("tmp-");

export function PitSetup({ events, items, canWrite }: { events: PitEvent[]; items: PitItem[]; canWrite: boolean }) {
  const [phase, setPhase] = useState<Phase>("pre_match");
  const [editing, setEditing] = useState<PitItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [undo, setUndo] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, apply] = useOptimistic(items, applyOp);
  const [, start] = useTransition();
  const move = useFabAction(movePitItem);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sections = [...new Set(view.map((i) => i.section).filter(Boolean))].sort();
  const list = view.filter((i) => i.phase === phase && !i.archived_at).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  const archived = view.filter((i) => i.phase === phase && i.archived_at);
  const picked = list.filter((i) => selected.has(i.id)).map((i) => i.id);

  /** Show the change now, save in the background; the server's copy replaces it when the save lands. */
  function act(op: Op, action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fields: [string, string][]) {
    setError(null);
    const fd = new FormData();
    for (const [k, v] of fields) fd.append(k, v);
    start(async () => {
      apply(op);
      const r = await action(fd);
      if (!r.ok) setError(r.error ?? "Couldn’t save");
    });
  }

  function add(titles: string[], section: string) {
    const clean = titles.map((t) => t.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const now = new Date().toISOString();
    const top = Math.max(0, ...list.map((i) => i.sort));
    const temp = clean.map((title, n): PitItem => ({ id: `tmp-${now}-${n}`, phase, section, title, how: "", critical: false, sort: top + (n + 1) * 10, archived_at: null, created_at: now }));
    act({ kind: "add", items: temp }, addPitItems, [["phase", phase], ["section", section], ["titles", clean.join("\n")]]);
  }

  function patch(ids: string[], fields: Partial<Pick<PitItem, "title" | "section" | "critical">>) {
    act({ kind: "patch", ids, patch: fields }, patchPitItem, [...ids.map((id): [string, string] => ["id", id]), ...Object.entries(fields).map(([k, v]): [string, string] => [k, String(v)])]);
  }

  function remove(ids: string[]) {
    act({ kind: "archive", ids, archived: true }, archivePitItem, ids.map((id) => ["id", id]));
    setSelected(new Set());
    setUndo(ids);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  }

  function restore(ids: string[]) {
    act({ kind: "archive", ids, archived: false }, archivePitItem, [...ids.map((id): [string, string] => ["id", id]), ["archived", "false"]]);
    setUndo(null);
  }

  function toggle(id: string, range: boolean) {
    const next = new Set(selected);
    if (range && anchor) {
      const a = list.findIndex((i) => i.id === anchor);
      const b = list.findIndex((i) => i.id === id);
      if (a >= 0 && b >= 0) {
        const on = !selected.has(id);
        for (const i of list.slice(Math.min(a, b), Math.max(a, b) + 1)) if (on) next.add(i.id); else next.delete(i.id);
        setSelected(next);
        setAnchor(id);
        return;
      }
    }
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setAnchor(id);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
      <section className="card">
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-2xl font-medium tracking-tight">Checklists</h2>
            {canWrite && (
              <button type="button" className="btn btn-ghost text-sm min-h-10 py-1.5" onClick={() => setImporting(true)}>
                Import from doc
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {PHASES.map((p) => (
              <button
                key={p}
                type="button"
                className="tile tile-chip"
                data-selected={phase === p}
                onClick={() => {
                  setPhase(p);
                  setSelected(new Set());
                }}
              >
                {PHASE_LABEL[p]} <span className="mono text-xs ml-1 opacity-70">{view.filter((i) => i.phase === p && !i.archived_at).length}</span>
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Click a check to rename it. Critical checks are listed first on every run and called out in the review. Order here is the order within a section.
            {canWrite && " Shift-click the boxes to select a range."}
          </p>
          <ErrorText error={move.error ?? error} />
          {undo && (
            <p className="text-sm flex items-center gap-2" role="status">
              Removed {undo.length === 1 ? "1 check" : `${undo.length} checks`}.
              <button type="button" className="underline font-medium" onClick={() => restore(undo)}>
                Undo
              </button>
            </p>
          )}
        </div>
        {canWrite && <QuickAdd phase={phase} sections={sections} onAdd={add} />}
        {canWrite && list.length > 0 && (
          <div className="px-4 py-2 border-t flex items-center gap-2 flex-wrap text-sm sticky top-0 z-10" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <input
              type="checkbox"
              aria-label="Select all"
              className="w-4 h-4"
              checked={picked.length > 0 && picked.length === list.length}
              ref={(el) => {
                if (el) el.indeterminate = picked.length > 0 && picked.length < list.length;
              }}
              onChange={() => setSelected(picked.length === list.length ? new Set() : new Set(list.filter((i) => !isTemp(i.id)).map((i) => i.id)))}
            />
            {picked.length === 0 ? (
              <span style={{ color: "var(--muted)" }}>Select all</span>
            ) : (
              <BulkBar
                count={picked.length}
                onRemove={() => remove(picked)}
                onCritical={(critical) => patch(picked, { critical })}
                onSection={(section) => patch(picked, { section })}
                onClear={() => setSelected(new Set())}
              />
            )}
          </div>
        )}
        <ul>
          {list.map((i, n) => (
            <Row
              key={i.id}
              item={i}
              canWrite={canWrite}
              selected={selected.has(i.id)}
              first={n === 0}
              last={n === list.length - 1}
              moving={move.pending}
              onToggle={(range) => toggle(i.id, range)}
              onRename={(title) => patch([i.id], { title })}
              onCritical={() => patch([i.id], { critical: !i.critical })}
              onMove={(dir) => move.call({ id: i.id, dir })}
              onDetails={() => setEditing(i)}
              onRemove={() => remove([i.id])}
            />
          ))}
          {list.length === 0 && (
            <li className="px-4 py-6 border-t text-sm text-center" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
              No {PHASE_LABEL[phase].toLowerCase()} checks yet.
            </li>
          )}
        </ul>
        {archived.length > 0 && (
          <div className="px-4 py-3 border-t" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-3">
              <button type="button" className="text-xs underline" style={{ color: "var(--muted)" }} onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? "Hide" : "Show"} {archived.length} removed
              </button>
              {showArchived && canWrite && archived.length > 1 && (
                <button type="button" className="text-xs underline" onClick={() => restore(archived.map((i) => i.id))}>
                  Restore all
                </button>
              )}
            </div>
            {showArchived && (
              <ul className="mt-2 flex flex-col gap-1">
                {archived.map((i) => (
                  <li key={i.id} className="text-sm flex items-center justify-between gap-2">
                    <span style={{ color: "var(--muted)" }}>{i.title}</span>
                    {canWrite && (
                      <button type="button" className="text-xs underline" onClick={() => restore([i.id])}>
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <Events events={events} canWrite={canWrite} />

      <Sheet open={importing} onClose={() => setImporting(false)} title="Import checklist" eyebrow="From a doc">
        {importing && <PitImport hasItems={items.some((i) => !i.archived_at)} onDone={() => setImporting(false)} />}
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit check">
        {editing && <ItemForm key={editing.id} item={editing} phase={phase} sections={sections} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

/** Type a check and press Enter; paste a list to add every line. */
function QuickAdd({ phase, sections, onAdd }: { phase: Phase; sections: string[]; onAdd: (titles: string[], section: string) => void }) {
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("");
  return (
    <form
      className="px-4 py-3 border-t flex gap-2 flex-wrap"
      style={{ borderColor: "var(--line)" }}
      onSubmit={(e) => {
        e.preventDefault();
        onAdd([title], section.trim());
        setTitle("");
      }}
    >
      <input
        className="input flex-1 min-w-[12rem]"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (!text.includes("\n")) return;
          e.preventDefault();
          onAdd(text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\[[ x]?\]|\d+[.)])\s*/i, "")), section.trim());
        }}
        placeholder={`Add a ${PHASE_LABEL[phase].toLowerCase()} check — Enter to add, paste a list for many`}
        aria-label="New check"
      />
      <input className="input w-36" list="pit-sections-list" value={section} onChange={(e) => setSection(e.target.value)} placeholder="Section" aria-label="Section for new checks" />
      <datalist id="pit-sections-list">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button type="submit" className="btn btn-primary text-sm min-h-10 py-1.5" disabled={!title.trim()}>
        Add
      </button>
    </form>
  );
}

function BulkBar({
  count,
  onRemove,
  onCritical,
  onSection,
  onClear,
}: {
  count: number;
  onRemove: () => void;
  onCritical: (critical: boolean) => void;
  onSection: (section: string) => void;
  onClear: () => void;
}) {
  const [section, setSection] = useState("");
  return (
    <>
      <span className="font-medium">{count} selected</span>
      <button type="button" className="btn btn-ghost text-sm min-h-9 py-1" onClick={() => onCritical(true)}>
        Mark critical
      </button>
      <button type="button" className="btn btn-ghost text-sm min-h-9 py-1" onClick={() => onCritical(false)}>
        Not critical
      </button>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSection(section.trim());
          setSection("");
        }}
      >
        <input className="input w-32 py-1 min-h-9" list="pit-sections-list" value={section} onChange={(e) => setSection(e.target.value)} placeholder="Section" aria-label="Move selected to section" />
        <button type="submit" className="btn btn-ghost text-sm min-h-9 py-1">
          Set
        </button>
      </form>
      <button type="button" className="btn btn-danger text-sm min-h-9 py-1" onClick={onRemove}>
        Remove {count}
      </button>
      <button type="button" className="text-xs underline" style={{ color: "var(--muted)" }} onClick={onClear}>
        Clear
      </button>
    </>
  );
}

function Row({
  item: i,
  canWrite,
  selected,
  first,
  last,
  moving,
  onToggle,
  onRename,
  onCritical,
  onMove,
  onDetails,
  onRemove,
}: {
  item: PitItem;
  canWrite: boolean;
  selected: boolean;
  first: boolean;
  last: boolean;
  moving: boolean;
  onToggle: (range: boolean) => void;
  onRename: (title: string) => void;
  onCritical: () => void;
  onMove: (dir: "up" | "down") => void;
  onDetails: () => void;
  onRemove: () => void;
}) {
  const temp = isTemp(i.id);
  const off = !canWrite || temp;
  return (
    <li className="px-4 py-2 border-t flex items-center gap-2" style={{ borderColor: "var(--line)", opacity: temp ? 0.6 : 1, background: selected ? "var(--purple-soft)" : undefined }}>
      {canWrite && (
        <input
          type="checkbox"
          className="w-4 h-4 shrink-0"
          checked={selected}
          disabled={temp}
          aria-label={`Select ${i.title}`}
          onClick={(e) => {
            e.preventDefault();
            onToggle(e.shiftKey);
          }}
          onChange={() => {}}
        />
      )}
      <div className="min-w-0 flex-1">
        {off ? (
          <span className="font-medium break-words">{i.title}</span>
        ) : (
          <input
            key={i.title}
            className="w-full font-medium bg-transparent rounded px-1 -mx-1 outline-none focus:ring-2"
            defaultValue={i.title}
            aria-label="Check"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = i.title;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (!v) e.currentTarget.value = i.title;
              else if (v !== i.title) onRename(v);
            }}
          />
        )}
        <span className="block text-xs" style={{ color: "var(--muted)" }}>
          {i.section || "No section"}
          {i.how ? ` · ${i.how}` : ""}
        </span>
      </div>
      {canWrite ? (
        <button
          type="button"
          className={`pill shrink-0 ${i.critical ? "pill-bad" : ""}`}
          style={{ fontSize: 11, ...(i.critical ? {} : { background: "var(--neutral-soft)", color: "var(--muted)" }) }}
          disabled={off}
          onClick={onCritical}
          aria-pressed={i.critical}
          title={i.critical ? "Critical — click to unmark" : "Click to mark critical"}
        >
          critical
        </button>
      ) : (
        i.critical && <span className="pill pill-bad shrink-0" style={{ fontSize: 11 }}>critical</span>
      )}
      {canWrite && (
        <div className="flex shrink-0">
          <button type="button" className="btn btn-ghost w-9 min-h-9 p-0" disabled={off || first || moving} onClick={() => onMove("up")} aria-label={`Move ${i.title} up`}>
            ↑
          </button>
          <button type="button" className="btn btn-ghost w-9 min-h-9 p-0 ml-1" disabled={off || last || moving} onClick={() => onMove("down")} aria-label={`Move ${i.title} down`}>
            ↓
          </button>
          <button type="button" className="btn btn-ghost w-9 min-h-9 p-0 ml-1" disabled={off} onClick={onDetails} aria-label={`Edit details of ${i.title}`} title="Section, phase, how to check">
            ⋯
          </button>
          <button type="button" className="btn btn-ghost w-9 min-h-9 p-0 ml-1" disabled={off} onClick={onRemove} aria-label={`Remove ${i.title}`} title="Remove (undo-able)">
            ✕
          </button>
        </div>
      )}
    </li>
  );
}

function ItemForm({ item, phase, sections, onDone }: { item?: PitItem; phase: Phase; sections: string[]; onDone: () => void }) {
  const save = useFabAction(savePitItem, onDone);
  const archive = useFabAction(archivePitItem, onDone);
  return (
    <form onSubmit={save.submit} className="flex flex-col gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Check">
        <input name="title" className="input" defaultValue={item?.title} placeholder="Radio ethernet secure" required autoFocus={!item} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="When">
          <select name="phase" className="input" defaultValue={item?.phase ?? phase}>
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Section">
          <input name="section" className="input" list="pit-sections" defaultValue={item?.section} placeholder="Electrical" />
          <datalist id="pit-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="How to check" hint="What “done” means, so anyone in the pit can do it.">
        <textarea name="how" className="input" defaultValue={item?.how} style={{ minHeight: 60 }} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="critical" defaultChecked={item?.critical} /> Critical — must be done every time
      </label>
      <ErrorText error={save.error ?? archive.error} />
      <SubmitButton pending={save.pending} label={item ? "Save check" : "Add check"} />
      {item && (
        <ConfirmButton
          label="Remove from checklist"
          message="It stops appearing on new runs. Past runs and the review keep it."
          onConfirm={() => archive.call({ id: item.id })}
          pending={archive.pending}
          danger
          link
        />
      )}
    </form>
  );
}

function Events({ events, canWrite }: { events: PitEvent[]; canWrite: boolean }) {
  const save = useFabAction(savePitEvent);
  const activate = useFabAction(setActivePitEvent);
  const del = useFabAction(deletePitEvent);
  return (
    <section className="card p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-2xl font-medium tracking-tight">Competitions</h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
          New runs and problems go to the active one. With none active they’re logged as practice.
        </p>
      </div>
      <ul className="flex flex-col">
        {events.map((e) => (
          <li key={e.id} className="py-2 border-t first:border-t-0 flex items-center gap-2" style={{ borderColor: "var(--line)" }}>
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">
                {e.name} {e.active && <span className="pill pill-good ml-1">Active</span>}
              </p>
              {(e.starts_on || e.ends_on) && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {fmtDate(e.starts_on)}
                  {e.ends_on && e.ends_on !== e.starts_on ? ` – ${fmtDate(e.ends_on)}` : ""}
                </p>
              )}
            </div>
            {canWrite && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost text-sm min-h-10 py-1.5 shrink-0"
                  disabled={activate.pending}
                  onClick={() => activate.call(e.active ? {} : { id: e.id })}
                >
                  {e.active ? "End" : "Make active"}
                </button>
                <ConfirmButton
                  label="✕"
                  message={`Delete ${e.name}? Its runs and problems stay, logged as practice.`}
                  confirmLabel="Delete"
                  onConfirm={() => del.call({ id: e.id })}
                  pending={del.pending}
                  danger
                  link
                />
              </>
            )}
          </li>
        ))}
        {events.length === 0 && (
          <li className="text-sm" style={{ color: "var(--muted)" }}>
            None yet.
          </li>
        )}
      </ul>
      <ErrorText error={activate.error ?? del.error} />
      {canWrite && (
        <form
          onSubmit={(e) => {
            save.submit(e);
            e.currentTarget.reset();
          }}
          className="flex flex-col gap-3 border-t pt-3"
          style={{ borderColor: "var(--line)" }}
        >
          <Field label="New competition">
            <input name="name" className="input" placeholder="Silicon Valley Regional" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input name="starts_on" type="date" className="input" />
            </Field>
            <Field label="Ends">
              <input name="ends_on" type="date" className="input" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="activate" defaultChecked /> Make it the active competition
          </label>
          <ErrorText error={save.error} />
          <SubmitButton pending={save.pending} label="Add competition" />
        </form>
      )}
    </section>
  );
}
