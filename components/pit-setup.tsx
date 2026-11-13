"use client";

import { useState } from "react";
import { archivePitItem, deletePitEvent, movePitItem, savePitEvent, savePitItem, setActivePitEvent } from "@/app/pit-actions";
import { PHASES, PHASE_LABEL, type Phase, type PitEvent, type PitItem } from "@/lib/pit";
import { fmtDate } from "@/lib/format";
import { ConfirmButton } from "./confirm-button";
import { ErrorText, Field, SubmitButton, useFabAction } from "./fab-ui";
import { PitImport } from "./pit-import";
import { Sheet } from "./sheet";

export function PitSetup({ events, items, canWrite }: { events: PitEvent[]; items: PitItem[]; canWrite: boolean }) {
  const [phase, setPhase] = useState<Phase>("pre_match");
  const [editing, setEditing] = useState<PitItem | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);
  const move = useFabAction(movePitItem);
  const archive = useFabAction(archivePitItem);
  const sections = [...new Set(items.map((i) => i.section).filter(Boolean))].sort();
  const list = items.filter((i) => i.phase === phase && !i.archived_at).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  const archived = items.filter((i) => i.phase === phase && i.archived_at);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
      <section className="card">
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-2xl font-medium tracking-tight">Checklists</h2>
            {canWrite && (
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost text-sm min-h-10 py-1.5" onClick={() => setImporting(true)}>
                  Import from doc
                </button>
                <button type="button" className="btn btn-primary text-sm min-h-10 py-1.5" onClick={() => setEditing("new")}>
                  + Add check
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {PHASES.map((p) => (
              <button key={p} type="button" className="tile tile-chip" data-selected={phase === p} onClick={() => setPhase(p)}>
                {PHASE_LABEL[p]} <span className="mono text-xs ml-1 opacity-70">{items.filter((i) => i.phase === p && !i.archived_at).length}</span>
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Critical checks are listed first on every run and called out in the review. Order here is the order within a section.
          </p>
          <ErrorText error={move.error ?? archive.error} />
        </div>
        <ul>
          {list.map((i, n) => (
            <li key={i.id} className="px-4 py-2.5 border-t flex items-center gap-2" style={{ borderColor: "var(--line)" }}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => canWrite && setEditing(i)} disabled={!canWrite}>
                <span className="font-medium break-words">{i.title}</span>
                {i.critical && <span className="pill pill-bad ml-2" style={{ fontSize: 11 }}>critical</span>}
                <span className="block text-xs" style={{ color: "var(--muted)" }}>
                  {i.section || "No section"}
                  {i.how ? ` · ${i.how}` : ""}
                </span>
              </button>
              {canWrite && (
                <div className="flex shrink-0">
                  <button type="button" className="btn btn-ghost w-10 min-h-10 p-0" disabled={n === 0 || move.pending} onClick={() => move.call({ id: i.id, dir: "up" })} aria-label={`Move ${i.title} up`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-ghost w-10 min-h-10 p-0 ml-1" disabled={n === list.length - 1 || move.pending} onClick={() => move.call({ id: i.id, dir: "down" })} aria-label={`Move ${i.title} down`}>
                    ↓
                  </button>
                </div>
              )}
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-4 py-6 border-t text-sm text-center" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
              No {PHASE_LABEL[phase].toLowerCase()} checks yet.
            </li>
          )}
        </ul>
        {archived.length > 0 && (
          <div className="px-4 py-3 border-t" style={{ borderColor: "var(--line)" }}>
            <button type="button" className="text-xs underline" style={{ color: "var(--muted)" }} onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? "Hide" : "Show"} {archived.length} removed
            </button>
            {showArchived && (
              <ul className="mt-2 flex flex-col gap-1">
                {archived.map((i) => (
                  <li key={i.id} className="text-sm flex items-center justify-between gap-2">
                    <span style={{ color: "var(--muted)" }}>{i.title}</span>
                    {canWrite && (
                      <button type="button" className="text-xs underline" onClick={() => archive.call({ id: i.id, archived: "false" })}>
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

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add check" : "Edit check"}>
        {editing && (
          <ItemForm
            key={editing === "new" ? "new" : editing.id}
            item={editing === "new" ? undefined : editing}
            phase={phase}
            sections={sections}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
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
