"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addPart, autoMatchParts, deletePart, importSheet, setPartStatus, updatePart } from "@/app/parts-actions";
import { isLengthKind, isStockKind, KIND_LABEL, needed, PART_KINDS, type FabPart, type PartKind } from "@/lib/parts";
import {
  isDone,
  isUrl,
  priorityLabel,
  PRIORITIES,
  readSheet,
  STATUS_LABEL,
  STATUS_TONE,
  STATUSES,
  SUGGEST,
  TRACKER_LABEL,
  type JobStatus,
  type Tracker,
} from "@/lib/tracker";
import { timeAgo } from "@/lib/format";
import { Sheet } from "./sheet";
import { Empty } from "./ui";
import { ErrorText, Field, SubmitButton, useFabAction } from "./fab-ui";
import { FabablePill, PersonChip } from "./parts-ui";

type Stock = Record<string, { name: string; onHand: string; low: boolean }>;
type FabJob = FabPart;

/** A part's sheet column by the sheet's name. */
function col(j: FabPart, k: string): string {
  switch (k) {
    case "material":
      return j.material_text;
    case "length":
      return j.length_text;
    case "dri":
      return j.assignees.join(", ");
    default:
      return String((j as unknown as Record<string, unknown>)[k] ?? "");
  }
}
type StatusFilter = "open" | "all" | "missing" | JobStatus;
const NO_SUBSYSTEM = "No subsystem";
const JUST_ADDED = "__just_added__";

/** What a part still needs before someone can make it (form field → label). Finished parts need nothing. */
function missing(j: FabPart): { field: string; label: string }[] {
  if (isDone(j.status)) return [];
  const out: { field: string; label: string }[] = [];
  if (!j.quantity) out.push({ field: "quantity", label: "Qty" });
  if (!j.material_text.trim()) out.push({ field: "material", label: "Material" });
  // machine and drawing file are often left blank on the team sheet, so they're not required
  if (j.kind !== "print") {
    if (isStockKind(j.kind) && !j.stock_dims.trim()) out.push({ field: "stock_dims", label: "Stock dims" });
    if (isLengthKind(j.kind) && !j.length_text.trim()) out.push({ field: "length", label: "Length" });
  }
  return out;
}
const lacks = (j: FabPart, field: string) => missing(j).some((m) => m.field === field);

/** What an in-place edit of a form field looks like on the part, so it shows before the server answers. */
function optimistic(field: string, v: string): Partial<FabPart> {
  switch (field) {
    case "priority": {
      const n = v.replace("#", "") ? Number(v.replace("#", "")) : null;
      return n === null || (Number.isInteger(n) && n >= 0 && n <= 4) ? { priority: n } : {};
    }
    case "quantity":
    case "spare_qty": {
      const n = Number(v);
      return v && Number.isFinite(n) ? { [field]: Math.max(0, Math.round(n)) } : {};
    }
    case "status":
      return { status: v as JobStatus, status_changed_at: new Date().toISOString() };
    case "material":
      return { material_text: v };
    case "length":
      return { length_text: v };
    default:
      return { [field]: v };
  }
}

/**
 * In-place edits: `save` shows the change at once and saves in the background
 * (nothing greys out or waits); a refused save puts the value back and the
 * cell shows why. `errors` / `notes` are keyed `id:field` / part id.
 */
type Saver = { save: (part: FabPart, field: string, value: string) => void; errors: Record<string, string>; notes: Record<string, string> };
const SaveContext = createContext<Saver | null>(null);
const omit = <T,>(o: Record<string, T>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
const useSave = () => useContext(SaveContext)!;

const byOrder = (list: string[]) => (a: string, b: string) => {
  const i = list.findIndex((x) => x.toLowerCase() === a.toLowerCase());
  const j = list.findIndex((x) => x.toLowerCase() === b.toLowerCase());
  return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b);
};

/** Distinct non-empty values, with the sheet's list first. */
function options(base: string[], jobs: FabJob[], key: string): string[] {
  const seen = new Map<string, string>();
  for (const v of [...base, ...jobs.map((j) => col(j, key).trim())]) if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()];
}

export function TrackerTable({
  tracker,
  parts: serverJobs,
  stock,
  copies,
  person,
  members,
}: {
  tracker: Tracker;
  parts: FabPart[];
  stock: Stock;
  copies: Record<string, number>;
  person: string;
  /** Everyone who has joined the workspace. */
  members: string[];
}) {
  const print = tracker === "print";
  const [status, setStatus] = useState<StatusFilter>("open");
  const [bot, setBot] = useState("");
  const [subsystem, setSubsystem] = useState("");
  const [machine, setMachine] = useState("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<FabJob | "new" | null>(null);
  const [importing, setImporting] = useState(false);

  // edits waiting on (or just back from) the server, laid over the server's rows
  const [over, setOver] = useState<Record<string, Partial<FabPart>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const latest = useRef<Record<string, number>>({});
  // part id → the fields of saves that have finished, dropped once fresh rows arrive
  const settled = useRef(new Map<string, string[]>());
  const seq = useRef(0);
  // rows edited in place stay where they were (same group, order and filter) until the view changes
  const view = [status, bot, subsystem, machine, q].join("\u0000");
  const [stay, setStay] = useState<{ view: string; rows: Map<string, FabPart> }>({ view, rows: new Map() });
  const stayed = stay.view === view ? stay.rows : null;
  // parts added from a group's blank row: shown at the bottom of that group, in the order typed, until the view changes
  const [fresh, setFresh] = useState<{ view: string; ids: string[] }>({ view, ids: [] });
  const freshIds = useMemo(() => (fresh.view === view ? fresh.ids : []), [fresh, view]);
  const [adding, setAdding] = useState<{ key: number; name: string; group: string; id?: string }[]>([]);
  // a new part's placeholder goes once its real row is here
  const pending = useMemo(() => {
    const have = new Set(serverJobs.map((j) => j.id));
    return adding.filter((x) => !x.id || !have.has(x.id));
  }, [adding, serverJobs]);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [importText, setImportText] = useState<string | null>(null);
  // the subsystem the top add bar puts new parts into (the filter's, else the one picked, else the first group)
  const [addInto, setAddInto] = useState("");
  // what the top add bar fills in on each new part; kept between adds, like copying a row down in the sheet
  const [draft, setDraft] = useState({ quantity: "1", material: "", stock_dims: "", machine: "" });
  // parts added from the top bar, shown right under it (in the order typed) so you can finish filling them in
  const [justAdded, setJustAdded] = useState<string[]>([]);

  const jobs = useMemo(() => {
    if (!Object.keys(over).length) return serverJobs;
    return serverJobs.map((j) => (over[j.id] ? { ...j, ...over[j.id] } : j));
  }, [serverJobs, over]);

  // fresh server rows replace edits that have saved
  useEffect(() => {
    if (!settled.current.size) return;
    const done = [...settled.current];
    settled.current.clear();
    setOver((o) => done.reduce((next, [id, keys]) => drop(next, id, keys), o));
  }, [serverJobs]);

  function drop(o: Record<string, Partial<FabPart>>, id: string, keys: string[]) {
    if (!o[id]) return o;
    const rest = { ...o[id] };
    for (const k of keys) delete rest[k as keyof FabPart];
    return Object.keys(rest).length ? { ...o, [id]: rest } : omit(o, id);
  }

  const saver: Saver = {
    errors,
    notes,
    save(part, field, value) {
      const key = `${part.id}:${field}`;
      const n = ++seq.current;
      latest.current[key] = n;
      const patch = optimistic(field, value);
      const keys = Object.keys(patch);
      // an earlier save of this field that finished mustn't clear this one
      const was = settled.current.get(part.id);
      if (was) settled.current.set(part.id, was.filter((k) => !keys.includes(k)));
      setOver((o) => ({ ...o, [part.id]: { ...o[part.id], ...patch } }));
      setErrors((x) => omit(x, key));
      if (field === "status") setNotes((x) => omit(x, part.id));
      setStay((s) => {
        const rows = new Map(s.view === view ? s.rows : []);
        if (!rows.has(part.id)) rows.set(part.id, part);
        return { view, rows };
      });
      const fd = new FormData();
      fd.set("id", part.id);
      fd.set(field, value);
      if (field === "status") fd.set("by", person);
      (field === "status" ? setPartStatus : updatePart)(fd)
        .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't save — check your connection" }))
        .then((r) => {
          if (latest.current[key] !== n) return; // a newer edit of this cell is on its way
          if (r.ok) {
            if (field === "status" && r.data) setNotes((x) => ({ ...x, [part.id]: r.data! }));
            settled.current.set(part.id, [...(settled.current.get(part.id) ?? []), ...keys]);
            return;
          }
          // refused: put it back
          setErrors((x) => ({ ...x, [key]: r.error }));
          setOver((o) => drop(o, part.id, keys));
        });
    },
  };

  const machineKey = print ? "material" : "machine";
  const bots = useMemo(() => options([], jobs, "bot").sort(byOrder(SUGGEST.bot)), [jobs]);
  const subsystems = useMemo(() => options([], jobs, "subsystem").sort(byOrder(SUGGEST.subsystem)), [jobs]);
  const machines = useMemo(() => options([], jobs, machineKey).sort(byOrder(print ? SUGGEST.filament : SUGGEST.machine)), [jobs, machineKey, print]);

  // counts ignore the status filter so the chips say what each one would show
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs.filter(
      (j) =>
        !!stayed?.has(j.id) ||
        freshIds.includes(j.id) ||
        ((!bot || j.bot.toLowerCase() === bot.toLowerCase()) &&
        (!subsystem || j.subsystem.toLowerCase() === subsystem.toLowerCase()) &&
        (!machine || col(j, machineKey).toLowerCase() === machine.toLowerCase()) &&
        (!needle || [j.name, j.notes, j.material_text, j.file, j.assignees.join(" "), j.designer, j.part_number].some((v) => v.toLowerCase().includes(needle)))),
    );
  }, [jobs, bot, subsystem, machine, machineKey, q, stayed, freshIds]);
  const need = (j: FabPart) => needed(j, j.design_id ? (copies[j.design_id] ?? 1) : 1);
  const lists = {
    bot: options(SUGGEST.bot, jobs, "bot"),
    subsystem: options(SUGGEST.subsystem, jobs, "subsystem"),
    material: options(print ? SUGGEST.filament : SUGGEST.material, jobs, "material"),
    stock_dims: options(SUGGEST.stock_dims, jobs, "stock_dims"),
    machine: options(SUGGEST.machine, jobs, "machine"),
    tapped: options(SUGGEST.tapped, jobs, "tapped"),
    people: [...new Set([...members, ...jobs.map((j) => j.designer), person].map((p) => p.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  };

  /** The sheet's columns, in its order. Status and Part stay put while the rest scrolls. */
  const cols: { key: string; label: string; w: number; pin?: number; render: (j: FabPart) => React.ReactNode }[] = [
    { key: "status", label: "Status", w: 150, pin: 0, render: (j) => <StatusSelect job={j} /> },
    {
      key: "part",
      label: "Part #_Name",
      w: 250,
      pin: 150,
      render: (j) => (
        <span className="flex items-center gap-1 min-w-0 px-1">
          <Link href={`/tracker/${j.id}`} className="font-medium hover:underline truncate" title={j.name}>
            {j.name}
          </Link>
          <button type="button" className="text-xs px-1 shrink-0" style={{ color: "var(--muted)" }} onClick={() => setEdit(j)} aria-label={`Edit everything for ${j.name}`} title="All fields">
            ✎
          </button>
          <NeedsPill job={j} />
          {j.cut_qty > 0 && isStockKind(j.kind) && j.cut_qty < need(j) && (
            <span className="chip shrink-0" title="Cut so far">
              {j.cut_qty}/{need(j)}
            </span>
          )}
        </span>
      ),
    },
    { key: "pri", label: "Priority", w: 72, render: (j) => <DropCell part={j} field="priority" value={j.priority === null ? "" : `#${j.priority}`} choices={PRIORITIES.map((p) => `#${p}`)} save={(v) => v.replace("#", "")} strict /> },
    { key: "bot", label: "Bot", w: 110, render: (j) => <DropCell part={j} field="bot" value={j.bot} choices={lists.bot} /> },
    { key: "sub", label: "Subsystem", w: 140, render: (j) => <DropCell part={j} field="subsystem" value={j.subsystem} choices={lists.subsystem} /> },
    { key: "qty", label: "Qty", w: 56, render: (j) => <Cell part={j} field="quantity" value={String(j.quantity)} numeric missing={lacks(j, "quantity")} /> },
    { key: "spare", label: "Spare", w: 60, render: (j) => <Cell part={j} field="spare_qty" value={j.spare_qty ? String(j.spare_qty) : ""} numeric /> },
    ...(print
      ? [
          { key: "mat", label: "Material", w: 170, render: (j: FabPart) => <DropCell part={j} field="material" value={j.material_text} choices={lists.material} missing={lacks(j, "material")} /> },
          { key: "infill", label: "Infill", w: 80, render: (j: FabPart) => <Cell part={j} field="infill" value={j.infill} /> },
        ]
      : [
          {
            key: "kind",
            label: "Kind",
            w: 120,
            render: (j: FabPart) => <DropCell part={j} field="kind" value={j.kind} choices={PART_KINDS.filter((k) => k !== "print")} labels={KIND_LABEL} strict required />,
          },
          {
            key: "mat",
            label: "Stock Material/Type",
            w: 250,
            render: (j: FabPart) => (
              <span className="block">
                <DropCell part={j} field="material" value={j.material_text} choices={lists.material} missing={lacks(j, "material")} />
                <StockNote job={j} stock={stock} />
              </span>
            ),
          },
          { key: "dims", label: "Stock Dimensions", w: 160, render: (j: FabPart) => <DropCell part={j} field="stock_dims" value={j.stock_dims} choices={lists.stock_dims} missing={lacks(j, "stock_dims")} /> },
          { key: "len", label: "Length", w: 90, render: (j: FabPart) => <Cell part={j} field="length" value={j.length_text} missing={lacks(j, "length")} /> },
          {
            key: "fab",
            label: "Fab-able?",
            w: 120,
            render: (j: FabPart) => (j.kind === "plate" ? <FabablePill part={j} /> : null),
          },
          { key: "tap", label: "Tapped?", w: 100, render: (j: FabPart) => <DropCell part={j} field="tapped" value={j.tapped} choices={lists.tapped} /> },
          { key: "machine", label: "Machine", w: 160, render: (j: FabPart) => <DropCell part={j} field="machine" value={j.machine} choices={lists.machine} /> },
        ]),
    { key: "designer", label: "Design DRI", w: 120, render: (j) => <PersonCell part={j} field="designer" value={j.designer} members={members} /> },
    {
      key: "file",
      label: print ? "STL File" : "Drawing/CAM File",
      w: 190,
      render: (j) => (
        <span className="flex items-center gap-1">
          <Cell part={j} field="file" value={j.file} />
          {isUrl(j.file) && (
            <a href={j.file} target="_blank" rel="noreferrer" className="text-xs shrink-0 px-1" style={{ color: "var(--purple)" }} aria-label="Open file link">
              ↗
            </a>
          )}
        </span>
      ),
    },
    { key: "notes", label: "Notes", w: 260, render: (j) => <Cell part={j} field="notes" value={j.notes} /> },
  ];

  const counts = useMemo(() => {
    const c = new Map<StatusFilter, number>([
      ["open", 0],
      ["all", base.length],
    ]);
    for (const j of base) {
      c.set(j.status, (c.get(j.status) ?? 0) + 1);
      if (missing(j).length) c.set("missing", (c.get("missing") ?? 0) + 1);
      if (!isDone(j.status)) c.set("open", c.get("open")! + 1);
    }
    return c;
  }, [base]);

  const groups = useMemo(() => {
    // a row edited in place is placed by how it was before the edit
    const at = (j: FabJob) => stayed?.get(j.id) ?? j;
    const shown = base.filter((j) => !justAdded.includes(j.id) && (stayed?.has(j.id) || freshIds.includes(j.id) || (status === "all" ? true : status === "open" ? !isDone(j.status) : status === "missing" ? missing(j).length > 0 : j.status === status)));
    const order = STATUSES[tracker];
    shown.sort((x, y) => {
      const fx = freshIds.indexOf(x.id);
      const fy = freshIds.indexOf(y.id);
      if (fx >= 0 || fy >= 0) return fx < 0 ? -1 : fy < 0 ? 1 : fx - fy;
      const a = at(x);
      const b = at(y);
      return (
        (a.priority ?? 9) - (b.priority ?? 9) ||
        order.indexOf(a.status) - order.indexOf(b.status) ||
        a.bot.localeCompare(b.bot) ||
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
    });
    const map = new Map<string, FabJob[]>();
    for (const j of shown) {
      const k = at(j).subsystem.trim() || NO_SUBSYSTEM;
      map.set(k, [...(map.get(k) ?? []), j]);
    }
    // a subsystem filter with nothing in it yet still gets a row to add into
    if (subsystem && !map.size) map.set(subsystem, []);
    return [...map.entries()].sort(([a], [b]) => byOrder(SUGGEST.subsystem)(a, b));
  }, [base, status, tracker, stayed, freshIds, subsystem, justAdded]);

  const addTo = subsystem || addInto || groups[0]?.[0] || SUGGEST.subsystem[0] || NO_SUBSYSTEM;

  /** Add parts by name into a group: they show at once, saved in the background, with the group's bot and subsystem. */
  function addNames(group: string, rows: FabJob[], names: string[], extra: Record<string, string> = {}, place = group) {
    const fields = { tracker, subsystem: group === NO_SUBSYSTEM ? "" : group, bot: bot || rows.at(-1)?.bot || "", ...(print ? { kind: "print" } : {}), ...extra };
    setAddErrors((x) => omit(x, place));
    for (const name of names) {
      const key = ++seq.current;
      // drop placeholders whose real rows already came in
      setAdding((a) => [...a.filter((x) => !x.id || !serverJobs.some((j) => j.id === x.id)), { key, name, group: place }]);
      const fd = new FormData();
      for (const [k, v] of Object.entries({ ...fields, name })) fd.set(k, v);
      addPart(fd)
        .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't save — check your connection" }))
        .then((r) => {
          if (!r.ok) {
            setAdding((a) => a.filter((x) => x.key !== key));
            setAddErrors((x) => ({ ...x, [place]: `Couldn't add ${name}: ${r.error}` }));
            return;
          }
          const id = r.data!;
          setAdding((a) => a.map((x) => (x.key === key ? { ...x, id } : x)));
          if (place === JUST_ADDED) setJustAdded((x) => [...x, id]);
          else setFresh((f) => ({ view, ids: [...(f.view === view ? f.ids : []), id] }));
        });
    }
  }

  /** A group's rows: cards on phones, the sheet's columns on desktop, then a blank row that adds to it. */
  function renderRows(name: string, rows: FabJob[], addLabel: string, onAdd: (names: string[]) => void) {
    return (
      <>
        {/* phones: cards */}
        <ul className="md:hidden flex flex-col gap-2">
          {rows.map((j) => (
            <li key={j.id} className="card p-3">
              <JobCard job={j} print={print} stock={stock} need={need(j)} onOpen={() => setEdit(j)} />
            </li>
          ))}
          {pending
            .filter((x) => x.group === name)
            .map((x) => (
              <li key={x.key} className="card p-3 text-sm">
                <span className="font-medium">{x.name}</span> <span style={{ color: "var(--muted)" }}>· adding…</span>
              </li>
            ))}
          <li className="card p-1">
            <QuickAdd className="cell cell-add" placeholder={addLabel} onAdd={onAdd} onSheet={setImportText} />
          </li>
          {addErrors[name] && <ErrorText error={addErrors[name]} />}
        </ul>
        {/* desktop: the sheet's columns */}
        <div className="hidden md:block card overflow-x-auto">
          <table className="sheet-table text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
            <colgroup>
              {cols.map((c) => (
                <col key={c.key} style={{ width: c.w }} />
              ))}
            </colgroup>
            <thead>
              <tr className="text-left eyebrow" style={{ color: "var(--muted)" }}>
                {cols.map((c) => (
                  <th key={c.key} className={`px-2 py-2 font-medium whitespace-nowrap ${c.pin !== undefined ? "pin" : ""}`} style={c.pin !== undefined ? { left: c.pin } : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className="border-t" style={{ borderColor: "var(--line)", opacity: isDone(j.status) ? 0.6 : 1 }}>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-1 py-1 ${c.pin !== undefined ? "pin" : ""}`} style={c.pin !== undefined ? { left: c.pin } : undefined}>
                      {c.render(j)}
                    </td>
                  ))}
                </tr>
              ))}
              {pending
                .filter((x) => x.group === name)
                .map((x) => (
                  <tr key={x.key} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="pin px-1 py-1" style={{ left: 0 }} />
                    <td className="pin px-1 py-1" style={{ left: 150 }}>
                      <span className="block px-1 font-medium truncate">{x.name}</span>
                    </td>
                    <td colSpan={cols.length - 2} className="px-2 py-1 text-xs" style={{ color: "var(--muted)" }}>
                      adding…
                    </td>
                  </tr>
                ))}
              <tr className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="pin px-1 py-1" style={{ left: 0 }} />
                <td className="pin px-1 py-1" style={{ left: 150 }}>
                  <QuickAdd className="cell cell-add" placeholder={addLabel} onAdd={onAdd} onSheet={setImportText} />
                </td>
                <td colSpan={cols.length - 2} className="px-2 py-1">
                  {addErrors[name] && <ErrorText error={addErrors[name]} />}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }

  const justRows = justAdded.map((id) => jobs.find((j) => j.id === id)).filter((j): j is FabJob => !!j);
  const addFromBar = (names: string[]) => {
    const extra = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v.trim() && (!print || k === "quantity" || k === "material")));
    addNames(addTo, groups.find(([g]) => g === addTo)?.[1] ?? [], names, extra, JUST_ADDED);
  };

  const total = jobs.length;
  const done = jobs.filter((j) => isDone(j.status)).length;
  const filtered = bot || subsystem || machine || q;

  return (
    <SaveContext.Provider value={saver}>
      {/* the sheet's dropdown lists, for every editable cell (and the edit form) */}
      {Object.entries(lists).map(([k, opts]) => (
        <datalist key={k} id={`tr-${k}`}>
          {opts.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ))}

      {/* progress + actions */}
      <div className="card p-5 mb-4 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="display text-3xl">
              {done} of {total}
            </span>
            <span className="text-[15px]" style={{ color: "var(--muted)" }}>
              parts finished{total ? ` · ${Math.round((done / total) * 100)}%` : ""}
            </span>
          </div>
          <div className="h-2.5 rounded-full mt-3 overflow-hidden" style={{ background: "var(--neutral-soft)" }}>
            <div className="h-full rounded-full" style={{ width: `${total ? (done / total) * 100 : 0}%`, background: "var(--good)" }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {!print && <AutoMatchButton />}
          <button type="button" className="btn btn-ghost text-sm flex-1 sm:flex-none" onClick={() => setImporting(true)}>
            Import from sheet
          </button>
          <button type="button" className="btn btn-primary text-sm flex-1 sm:flex-none" onClick={() => setEdit("new")}>
            Add part <span aria-hidden>→</span>
          </button>
        </div>
      </div>

      {/* status chips */}
      <div className="hscroll no-scrollbar flex gap-2 mb-3 -mx-4 px-4">
        {(["open", "all", "missing", ...STATUSES[tracker]] as StatusFilter[]).map((s) => {
          const n = counts.get(s) ?? 0;
          if (s !== "open" && s !== "all" && !n && status !== s) return null;
          return (
            <button key={s} type="button" className="tile tile-chip text-sm" data-selected={status === s} onClick={() => setStatus(s)}>
              {s === "open" ? "Still to make" : s === "all" ? "All" : s === "missing" ? "Needs info" : STATUS_LABEL[s]}{" "}
              <span className="font-semibold" style={{ color: s === "missing" ? "var(--warn)" : "var(--muted)" }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <FilterSelect label="Bot" value={bot} onChange={setBot} options={bots} />
        <FilterSelect label="Subsystem" value={subsystem} onChange={setSubsystem} options={subsystems} />
        <FilterSelect label={print ? "Material" : "Machine"} value={machine} onChange={setMachine} options={machines} />
        <input className="input col-span-2 sm:col-span-1" placeholder="Search parts, notes, people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the tracker" />
      </div>

      {/* add parts like typing a row into the sheet: the name, plus the few things picked from a list */}
      <div className="card p-2 mb-4">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <QuickAdd className="input col-span-2 sm:flex-1 sm:min-w-[240px]" placeholder="+ Part name, then Enter (or paste a list)" onAdd={addFromBar} onSheet={setImportText} />
          <input
            className="input mono sm:w-20"
            type="number"
            min={0}
            inputMode="numeric"
            value={draft.quantity}
            onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
            aria-label="Qty for new parts"
            title="Qty"
          />
          <BarSelect label="Material" value={draft.material} options={lists.material} onChange={(v) => setDraft((d) => ({ ...d, material: v }))} />
          {!print && (
            <>
              <BarSelect label="Stock dims" value={draft.stock_dims} options={lists.stock_dims} onChange={(v) => setDraft((d) => ({ ...d, stock_dims: v }))} />
              <BarSelect label="Machine" value={draft.machine} options={lists.machine} onChange={(v) => setDraft((d) => ({ ...d, machine: v }))} />
            </>
          )}
          <select className="input sm:w-48" value={addTo} onChange={(e) => setAddInto(e.target.value)} aria-label="Subsystem for new parts">
            {[...new Set([...lists.subsystem, ...groups.map(([g]) => g)])].map((s) => (
              <option key={s} value={s}>
                {s === NO_SUBSYSTEM ? "No subsystem" : `Into ${s}`}
              </option>
            ))}
            {!lists.subsystem.includes(NO_SUBSYSTEM) && !groups.some(([g]) => g === NO_SUBSYSTEM) && <option value={NO_SUBSYSTEM}>No subsystem</option>}
          </select>
        </div>
        {addErrors[JUST_ADDED] && !justRows.length && <ErrorText error={addErrors[JUST_ADDED]} />}
      </div>
      {(justRows.length > 0 || pending.some((x) => x.group === JUST_ADDED)) && (
        <section className="mb-6">
          <h2 className="eyebrow mb-2 flex items-center gap-2" style={{ color: "var(--purple)" }}>
            Just added <span className="mono">{justRows.length}</span>
            <span className="normal-case tracking-normal font-normal" style={{ color: "var(--muted)" }}>
              · fill in what&apos;s outlined
            </span>
            <button type="button" className="ml-auto btn btn-ghost text-xs py-1" onClick={() => setJustAdded([])}>
              Done, put them in the list
            </button>
          </h2>
          {renderRows(JUST_ADDED, justRows, "+ Another part (same as the bar above)", addFromBar)}
        </section>
      )}

      {total === 0 ? (
        <Empty>
          Nothing on the {TRACKER_LABEL[tracker].toLowerCase()} tracker yet. Copy the rows (with the header) out of the team sheet and use Import from sheet, add parts one at a time, or{" "}
          <Link href="/tracker/designs" className="underline" style={{ color: "var(--purple)" }}>
            load them from Onshape
          </Link>
          .
        </Empty>
      ) : groups.length === 0 ? (
        <Empty>
          Nothing matches.{" "}
          {(filtered || status !== "all") && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                setBot("");
                setSubsystem("");
                setMachine("");
                setQ("");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([name, rows]) => (
            <section key={name}>
              <h2 className="eyebrow mb-2 flex items-center gap-2" style={{ color: "var(--muted)" }}>
                {name} <span className="mono">{rows.length}</span>
              </h2>
              {renderRows(name, rows, `+ Add a part to ${name}`, (names) => addNames(name, rows, names))}
            </section>
          ))}
        </div>
      )}

      <Sheet open={edit !== null} onClose={() => setEdit(null)} eyebrow={TRACKER_LABEL[tracker]} title={edit === "new" ? "Add part" : "Edit part"}>
        {edit !== null && (
          <JobForm
            key={edit === "new" ? "new" : edit.id}
            tracker={tracker}
            job={edit === "new" ? null : edit}
            stock={stock}
            person={person}
            defaults={{ bot, subsystem, designer: person }}
            onDone={() => setEdit(null)}
          />
        )}
      </Sheet>
      <Sheet
        open={importing || importText !== null}
        onClose={() => {
          setImporting(false);
          setImportText(null);
        }}
        eyebrow={TRACKER_LABEL[tracker]}
        title="Import from sheet"
      >
        {(importing || importText !== null) && (
          <ImportForm
            tracker={tracker}
            initial={importText ?? ""}
            onDone={() => {
              setImporting(false);
              setImportText(null);
            }}
          />
        )}
      </Sheet>
    </SaveContext.Provider>
  );
}

/** Re-match every part to the rack stock that fits it (parts with stock picked by hand are kept). */
function AutoMatchButton() {
  const [note, setNote] = useState<string | null>(null);
  const a = useFabAction(autoMatchParts, (r) => {
    if (!r) return;
    setNote(
      `${r.changed ? `Updated ${r.changed} ${r.changed === 1 ? "part" : "parts"}` : "Already up to date"} · ${r.matched}/${r.checked} matched${r.unmatched ? `, ${r.unmatched} have nothing on the rack that fits` : ""}${r.skipped ? ` · ${r.skipped} skipped (hand-picked or already cut)` : ""}`,
    );
  });
  return (
    <div className="flex flex-col gap-1 flex-1 sm:flex-none">
      <button
        type="button"
        className="btn btn-ghost text-sm"
        disabled={a.pending}
        title="Match every part to the stock on the rack. Parts whose stock you picked by hand are left alone."
        onClick={() => {
          setNote(null);
          a.call({});
        }}
      >
        {a.pending ? "Matching…" : "Auto-match stock"}
      </button>
      {note && (
        <span className="text-xs max-w-[260px]" role="status" style={{ color: "var(--muted)" }}>
          {note}
        </span>
      )}
      <ErrorText error={a.error} />
    </div>
  );
}

/**
 * The blank row under a group: type a part name and press Enter to add it,
 * then fill its other cells in place. Pasting a list of names adds each one;
 * pasting rows copied from the team sheet opens Import with them.
 */
function QuickAdd({ className, placeholder, onAdd, onSheet }: { className: string; placeholder: string; onAdd: (names: string[]) => void; onSheet: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <input
      className={className}
      placeholder={placeholder}
      aria-label="Add a part: type its name and press Enter"
      title="Type a name and press Enter. Paste a list of names to add them all."
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && v.trim()) {
          e.preventDefault();
          onAdd([v.trim()]);
          setV("");
        }
        if (e.key === "Escape") {
          setV("");
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData("text");
        if (!text.trim().includes("\n")) return;
        e.preventDefault();
        if (text.includes("\t")) return onSheet(text);
        const names = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (names.length) onAdd(names);
      }}
    />
  );
}

/**
 * A spreadsheet cell: reads like text, edits in place, saves when you leave
 * it (Enter saves, Esc puts it back).
 */
function Cell({ part, field, value, list, numeric, missing }: { part: FabPart; field: string; value: string; list?: string; numeric?: boolean; missing?: boolean }) {
  const { save, errors } = useSave();
  const error = errors[`${part.id}:${field}`];
  return (
    <input
      key={value}
      defaultValue={value}
      list={list}
      inputMode={numeric ? "numeric" : undefined}
      aria-label={`${field.replace("_", " ")} for ${part.name}`}
      className={`cell ${numeric ? "mono text-right" : ""}`}
      placeholder={missing ? "needed" : undefined}
      data-missing={missing}
      data-error={!!error}
      title={error ?? (value || undefined)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v !== value.trim()) save(part, field, v);
      }}
    />
  );
}

/**
 * A searchable people dropdown: the workspace's members first, then type to
 * filter. Enter picks the highlighted one (or whatever was typed), Esc closes.
 */
function PersonCell({ part, field, value, members }: { part: FabPart; field: string; value: string; members: string[] }) {
  const { save, errors } = useSave();
  const error = errors[`${part.id}:${field}`];
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const needle = q.trim().toLowerCase();
  const shown = members.filter((m) => !needle || m.toLowerCase().includes(needle));
  const typed = q.trim() && !members.some((m) => m.toLowerCase() === needle) ? q.trim() : "";
  const opts = [...shown, ...(typed ? [typed] : [])];

  function open() {
    const r = btn.current!.getBoundingClientRect();
    setAt({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 220) });
    setQ("");
    setHi(Math.max(0, members.findIndex((m) => m.toLowerCase() === value.toLowerCase())));
  }
  function pick(v: string) {
    setAt(null);
    if (v !== value) save(part, field, v);
    btn.current?.focus();
  }

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="cell text-left"
        data-error={!!error}
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
        title={error ?? (value || undefined)}
        aria-label={`Design DRI for ${part.name}`}
        aria-haspopup="listbox"
        aria-expanded={!!at}
        onClick={() => (at ? setAt(null) : open())}
      >
        {value && <PersonChip name={value} size={18} />}
        <span className="truncate">{value}</span>
      </button>
      {at &&
        createPortal(
          <div
            ref={pop}
            className="fade-in"
            style={{
              position: "fixed",
              left: Math.min(at.left, window.innerWidth - at.width - 8),
              top: at.top,
              width: at.width,
              zIndex: 60,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              boxShadow: "var(--shadow-md)",
              padding: 6,
            }}
          >
            <input
              autoFocus
              className="input text-sm"
              placeholder="Search people…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHi((h) => Math.min(h + 1, opts.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHi((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (opts[hi]) pick(opts[hi]);
                } else if (e.key === "Escape") {
                  setAt(null);
                  btn.current?.focus();
                }
              }}
            />
            <div role="listbox" className="mt-1 flex flex-col overflow-y-auto" style={{ maxHeight: 260 }}>
              {opts.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  role="option"
                  aria-selected={m === value}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left"
                  style={{ background: i === hi ? "var(--paper)" : undefined, fontWeight: m === value ? 600 : undefined }}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(m)}
                >
                  <PersonChip name={m} size={20} />
                  <span className="truncate">{m === typed ? `Use “${m}”` : m}</span>
                </button>
              ))}
              {!opts.length && (
                <span className="px-2 py-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  No one joined matches
                </span>
              )}
              {value && (
                <button type="button" className="mt-1 px-2 py-1.5 text-sm text-left rounded-md" style={{ color: "var(--muted)", borderTop: "1px solid var(--line)" }} onClick={() => pick("")}>
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * A dropdown cell like the sheet's: its list of choices, the current value
 * even when it's not on the list, and (unless `strict`) "Other…" to type one.
 */
const OTHER = "__other__";

function DropCell({
  part,
  field,
  value,
  choices,
  labels,
  strict,
  required,
  missing,
  save = (v) => v,
}: {
  part: FabPart;
  field: string;
  value: string;
  choices: string[];
  labels?: Record<string, string>;
  strict?: boolean;
  /** no blank choice */
  required?: boolean;
  /** needed before the part can be made */
  missing?: boolean;
  save?: (v: string) => string;
}) {
  const { save: saveField, errors } = useSave();
  const error = errors[`${part.id}:${field}`];
  const [typing, setTyping] = useState(false);
  const shown = value;
  const opts = shown && !choices.some((c) => c.toLowerCase() === shown.toLowerCase()) ? [shown, ...choices] : choices;
  if (typing) {
    return (
      <input
        autoFocus
        defaultValue={value}
        className="cell"
        aria-label={`${field} for ${part.name}`}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setTyping(false);
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          setTyping(false);
          if (v !== value) saveField(part, field, save(v));
        }}
      />
    );
  }
  return (
    <select
      key={value}
      defaultValue={shown}
      aria-label={`${field} for ${part.name}`}
      className="cell"
      data-empty={!shown}
      data-missing={missing}
      data-error={!!error}
      title={error ?? ((labels?.[shown] ?? shown) || undefined)}
      style={{ color: field === "priority" && shown === "#0" ? "var(--bad)" : undefined }}
      onChange={(e) => {
        const v = e.target.value;
        if (v === OTHER) {
          e.target.value = shown;
          setTyping(true);
          return;
        }
        saveField(part, field, save(v));
      }}
    >
      {(!required || !shown) && <option value="">{missing ? "needed" : "—"}</option>}
      {opts.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
      {!strict && <option value={OTHER}>Other…</option>}
    </select>
  );
}

/** A pick on the add bar: blank until chosen, "Other…" to type one. */
function BarSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const [typing, setTyping] = useState(false);
  if (typing)
    return (
      <input
        autoFocus
        className="input sm:w-44"
        placeholder={label}
        defaultValue={value}
        aria-label={`${label} for new parts`}
        onBlur={(e) => {
          onChange(e.currentTarget.value.trim());
          setTyping(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
      />
    );
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      className="input sm:w-44"
      value={value}
      onChange={(e) => (e.target.value === OTHER ? setTyping(true) : onChange(e.target.value))}
      aria-label={`${label} for new parts`}
      style={{ color: value ? undefined : "var(--muted)" }}
    >
      <option value="">{label}</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={OTHER}>Other…</option>
    </select>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ color: value ? undefined : "var(--muted)" }}>
      <option value="">All {label.toLowerCase()}s</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/**
 * Status as a pill you can change in place. Moving a stock part to In
 * Progress / Finished takes its stock off the rack; the note says what.
 */
function StatusSelect({ job }: { job: FabJob }) {
  const { save, errors, notes } = useSave();
  const error = errors[`${job.id}:status`];
  const note = notes[job.id];
  const tone = STATUS_TONE[job.status];
  const list = STATUSES[job.kind === "print" ? "print" : "machining"];
  const opts = list.includes(job.status) ? list : [job.status, ...list];
  return (
    <span className="inline-flex flex-col gap-0.5">
      <select
        className={`pill pill-${tone} cursor-pointer`}
        style={{ appearance: "auto", border: 0 }}
        value={job.status}
        onChange={(e) => save(job, "status", e.target.value)}
        aria-label={`Status of ${job.name}`}
        title={`Since ${timeAgo(job.status_changed_at)}`}
      >
        {opts.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-xs" style={{ color: "var(--bad)" }}>
          {error}
        </span>
      )}
      {note && (
        <span className="text-xs max-w-[200px]" style={{ color: /^Took/.test(note) ? "var(--good)" : "var(--warn)" }} role="status">
          {note}
        </span>
      )}
    </span>
  );
}

/** "needs 3" on a part that can't be made yet; hover says what. */
function NeedsPill({ job }: { job: FabJob }) {
  const m = missing(job);
  if (!m.length) return null;
  return (
    <span className="pill pill-warn shrink-0 text-xs" title={`Still needs: ${m.map((x) => x.label).join(", ")}`}>
      needs {m.length}
    </span>
  );
}

function JobCard({ job: j, print, stock, need, onOpen }: { job: FabJob; print: boolean; stock: Stock; need: number; onOpen: () => void }) {
  const details = print
    ? [j.material_text, j.infill && `${j.infill} infill`, j.designer && `Design ${j.designer}`]
    : [KIND_LABEL[j.kind], j.material_text, j.stock_dims, j.length_text && `L ${j.length_text}`, j.tapped && `tap: ${j.tapped}`, j.machine, j.designer && `Design ${j.designer}`];
  return (
    <div className="tracker-job-card flex flex-col gap-2" style={{ opacity: isDone(j.status) ? 0.65 : 1 }}>
      <div className="flex items-start gap-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <span className="font-medium break-words">
            {j.priority !== null && (
              <span className="mono mr-1.5" style={{ color: j.priority === 0 ? "var(--bad)" : "var(--muted)" }}>
                {priorityLabel(j.priority)}
              </span>
            )}
            {j.name}
          </span>
          <span className="block text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {j.bot || "No bot"} · {j.quantity}
            {j.spare_qty > 0 && ` + ${j.spare_qty} spare`}
            {j.cut_qty > 0 && isStockKind(j.kind) && j.cut_qty < need && ` · cut ${j.cut_qty}/${need}`}
          </span>
        </button>
        <StatusSelect job={j} />
      </div>
      <button type="button" className="flex flex-wrap gap-1.5 text-left" onClick={onOpen}>
        {details.filter(Boolean).map((d, i) => (
          <span key={i} className="chip">
            {d}
          </span>
        ))}
      </button>
      {!print && j.kind === "plate" && (
        <span>
          <FabablePill part={j} />
        </span>
      )}
      {!print && <StockNote job={j} stock={stock} />}
      {missing(j).length > 0 && (
        <button type="button" className="text-xs text-left font-medium" style={{ color: "var(--warn)" }} onClick={onOpen}>
          Still needs: {missing(j).map((x) => x.label).join(", ")} →
        </button>
      )}
      <div className="flex items-center gap-2 text-xs min-w-0">
        <FileCell file={j.file} />
        <Link href={`/tracker/${j.id}`} className="ml-auto underline shrink-0" style={{ color: "var(--purple)" }}>
          Files &amp; checks →
        </Link>
      </div>
      {j.notes && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {j.notes}
        </p>
      )}
    </div>
  );
}

function StockNote({ job, stock }: { job: FabJob; stock: Stock }) {
  const s = job.material_id ? stock[job.material_id] : undefined;
  if (!s) return null;
  return (
    <a href={`/stock/${job.material_id}`} className="block text-xs mt-0.5 underline" style={{ color: s.low ? "var(--warn)" : "var(--good)" }} onClick={(e) => e.stopPropagation()}>
      {s.onHand}
    </a>
  );
}

function FileCell({ file }: { file: string }) {
  if (!file.trim()) return null;
  if (isUrl(file)) {
    const host = file.includes("drive.google") ? "Drive" : file.includes("onshape") ? "Onshape" : "Link";
    return (
      <a href={file} target="_blank" rel="noreferrer" className="chip underline">
        {host} ↗
      </a>
    );
  }
  return (
    <span className="mono text-xs break-all" style={{ color: "var(--muted)" }} title={file}>
      {file}
    </span>
  );
}

function TextField({ name, label, value, list, placeholder }: { name: string; label: string; value: string; list?: string; placeholder?: string }) {
  return (
    <Field label={label}>
      <input name={name} className="input" defaultValue={value} list={list} placeholder={placeholder} autoComplete="off" />
    </Field>
  );
}

function JobForm({
  tracker,
  job,
  stock,
  person,
  defaults,
  onDone,
}: {
  tracker: Tracker;
  job: FabJob | null;
  stock: Stock;
  person: string;
  defaults: { bot: string; subsystem: string; designer: string };
  onDone: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const a = useFabAction(job ? updatePart : addPart, (n) => {
    // a status change that took stock says so before closing
    if (job && typeof n === "string" && n) setNote(n);
    else onDone();
  });
  const del = useFabAction(deletePart, onDone);
  const [kind, setKind] = useState<PartKind | "">(job?.kind ?? "");
  const [confirm, setConfirm] = useState(false);
  const print = tracker === "print";
  const j = job;
  const v = (k: string) => (j ? col(j, k) : "");
  const stockList = Object.entries(stock).sort(([, x], [, y]) => x.name.localeCompare(y.name));

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={a.submit} className="flex flex-col gap-3">
        {j && <input type="hidden" name="id" value={j.id} />}
        <input type="hidden" name="tracker" value={tracker} />
        <input type="hidden" name="by" value={person} />
        <TextField name="name" label="Part # / name" value={v("name")} placeholder="0201_Mounting_Plate" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Status">
            <select name="status" className="input" defaultValue={j?.status ?? "not_started"}>
              {(j && !STATUSES[tracker].includes(j.status) ? [j.status, ...STATUSES[tracker]] : STATUSES[tracker]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select name="priority" className="input" defaultValue={j?.priority ?? ""}>
              <option value="">—</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  #{p}
                  {p === 0 ? " (urgent)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <TextField name="bot" label="Bot" value={j ? v("bot") : defaults.bot} list="tr-bot" />
          <TextField name="subsystem" label="Subsystem" value={j ? v("subsystem") : defaults.subsystem} list="tr-subsystem" />
          <Field label="Qty">
            <input name="quantity" type="number" min="0" inputMode="numeric" className="input mono" defaultValue={j?.quantity ?? 1} />
          </Field>
          <Field label="Spare qty">
            <input name="spare_qty" type="number" min="0" inputMode="numeric" className="input mono" defaultValue={j?.spare_qty ?? 0} />
          </Field>
        </div>
        {print ? (
          <div className="grid grid-cols-2 gap-2">
            <TextField name="material" label="Material" value={v("material")} list="tr-material" />
            <TextField name="infill" label="Infill" value={v("infill")} placeholder="40%" />
            <TextField name="designer" label="Design DRI" value={j ? v("designer") : defaults.designer} list="tr-people" />
          </div>
        ) : (
          <>
            <Field label="Kind" hint="How it's made — picks its board, DFM checks and stock. Blank = from the material.">
              <select name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as PartKind | "")}>
                {!j && <option value="">From the material</option>}
                {PART_KINDS.filter((k) => k !== "print").map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <TextField name="material" label="Stock material / type" value={v("material")} list="tr-material" />
              <TextField name="stock_dims" label="Stock dimensions" value={v("stock_dims")} list="tr-stock_dims" />
              <TextField name="length" label="Length" value={v("length")} placeholder='18.5"' />
              <TextField name="tapped" label="Tapped?" value={v("tapped")} list="tr-tapped" />
              <TextField name="machine" label="Machine" value={v("machine")} list="tr-machine" />
              <TextField name="designer" label="Design DRI" value={j ? v("designer") : defaults.designer} list="tr-people" />
              </div>
            <Field label="Cut from (on the rack)" hint="Matched from the material and dims automatically; pick one to lock it. Stock is taken off the rack when the part goes In Progress / Finished.">
              <select name="material_id" className="input" defaultValue={j?.material_locked ? (j.material_id ?? "") : "auto"}>
                <option value="auto">Auto{j?.material_id && !j.material_locked && stock[j.material_id] ? ` (${stock[j.material_id].name})` : ""}</option>
                <option value="">None</option>
                {stockList.map(([id, s]) => (
                  <option key={id} value={id}>
                    {s.name} — {s.onHand}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <TextField name="file" label={print ? "STL file" : "Drawing / CAM file (STEP)"} value={v("file")} placeholder="File name or a Drive / Onshape link" />
        <Field label="Notes">
          <textarea name="notes" className="input" rows={2} defaultValue={v("notes")} />
        </Field>
        {print && <input type="hidden" name="kind" value="print" />}
        <ErrorText error={a.error} />
        {note ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm" style={{ color: /^Took/.test(note) ? "var(--good)" : "var(--warn)" }} role="status">
              Saved. {note}
            </p>
            <button type="button" className="btn btn-primary py-3" onClick={onDone}>
              Done <span aria-hidden>→</span>
            </button>
          </div>
        ) : (
          <SubmitButton pending={a.pending} label={j ? "Save" : "Add to tracker"} />
        )}
        {j && (
          <Link href={`/tracker/${j.id}`} className="btn btn-ghost">
            Files, DFM checks &amp; history <span aria-hidden>→</span>
          </Link>
        )}
      </form>
      {j && (
        <div className="pt-4 border-t flex flex-col gap-2" style={{ borderColor: "var(--line)" }}>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {STATUS_LABEL[j.status]} since {timeAgo(j.status_changed_at)} · added {timeAgo(j.created_at)}
          </p>
          <ErrorText error={del.error} />
          {confirm ? (
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost flex-1" onClick={() => setConfirm(false)}>
                Keep it
              </button>
              <button type="button" className="btn btn-danger flex-1" disabled={del.pending} onClick={() => del.call({ id: j.id })}>
                {del.pending ? "Deleting…" : "Delete for good"}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
              Delete part
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ImportForm({ tracker, initial, onDone }: { tracker: Tracker; initial: string; onDone: () => void }) {
  const [text, setText] = useState(initial);
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const a = useFabAction(importSheet, (r) => {
    if (r) setResult(r);
  });
  const read = useMemo(() => (text.trim() ? readSheet(text) : null), [text]);

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Added <b>{result.added}</b> and updated <b>{result.updated}</b> {result.added + result.updated === 1 ? "part" : "parts"}.
        </p>
        <button type="button" className="btn btn-primary py-3" onClick={onDone}>
          Done <span aria-hidden>→</span>
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={a.submit} className="flex flex-col gap-3">
      <input type="hidden" name="tracker" value={tracker} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        In the {tracker === "print" ? "3D Printing" : "Machining"} Tracker tab, select from the header row (Status, Bot, …) down to the last part, copy, and paste here. A CSV
        export works too. Parts already here (same bot and name, including ones synced from Onshape) are updated, not doubled.
      </p>
      <textarea
        name="text"
        className="input mono text-xs"
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Status\tBot\tSubsystem\tPart #_Name\tPriority\tQty\t…"}
        spellCheck={false}
      />
      {read?.error && <p className="text-sm" style={{ color: "var(--warn)" }}>{read.error}</p>}
      {read && !read.error && (
        <div className="card p-3 text-sm flex flex-col gap-1" style={{ background: "var(--paper)" }}>
          <p>
            <b>{read.rows.length}</b> parts found{read.skipped ? ` · ${read.skipped} blank / section rows skipped` : ""}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Columns: {read.columns.join(", ")}
          </p>
          <ul className="text-xs mt-1 flex flex-col gap-0.5">
            {read.rows.slice(0, 4).map((r, i) => (
              <li key={i} className="truncate">
                <span className={`pill pill-${STATUS_TONE[r.status]} mr-1`}>{STATUS_LABEL[r.status]}</span>
                {r.name} {r.bot && <span style={{ color: "var(--muted)" }}>· {r.bot}</span>}
              </li>
            ))}
            {read.rows.length > 4 && <li style={{ color: "var(--muted)" }}>…and {read.rows.length - 4} more</li>}
          </ul>
        </div>
      )}
      <ErrorText error={a.error} />
      <button type="submit" className="btn btn-primary py-3" disabled={a.pending || !read || !!read.error || !read.rows.length}>
        {a.pending ? "Importing…" : read?.rows.length ? `Import ${read.rows.length} parts` : "Import"} <span aria-hidden>→</span>
      </button>
    </form>
  );
}
