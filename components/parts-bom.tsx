"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addCotsPart, editCotsParts, findCotsLinks, setCotsStatus, setPartsSubsystem, setSpares, updatePart } from "@/app/parts-actions";
import { COTS_LABEL, COTS_STATUSES, COTS_TONE, KIND_LABEL, multiplierOf, PART_KINDS, SPARE_LABEL, SPARE_MODES, type CotsStatus, type SpareMode } from "@/lib/parts";
import { Empty } from "./ui";
import { DeletePartSheet } from "./delete-part-sheet";
import { Sheet } from "./sheet";
import { ErrorText, Field, SubmitButton, useFabAction } from "./fab-ui";

/** How many to order: packs when it's sold in packs. */
const buyQty = (l: Pick<BomLine, "need" | "pack_size">) => (l.pack_size ? Math.ceil(l.need / l.pack_size) : l.need);

const money = (n: number | null) => (n === null ? "" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** The team's buy-list columns: Name, Link, Part #, Qty, Unit price, Total. */
function sheetRows(sections: [string, BomLine[]][]): string[][] {
  const out: string[][] = [];
  for (const [, rows] of sections) {
    if (!rows.length) continue;
    if (out.length) out.push(["", "", "", "", "", ""]); // a blank row between parts and hardware, like the sheet
    for (const l of rows) {
      const name = l.pack_size ? `${l.name} (${l.pack_size}-pack)` : l.name;
      out.push([name, l.url, l.part_number, String(buyQty(l)), money(l.unit_price), l.unit_price === null ? "" : money(l.unit_price * buyQty(l))]);
    }
  }
  return out;
}

const tsv = (rows: string[][]) => rows.map((r) => r.map((c) => c.replace(/[\t\n\r]+/g, " ")).join("\t")).join("\n");
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");

export interface BomLine {
  id: string;
  name: string;
  onshape_key: string | null;
  part_number: string;
  description: string;
  /** across every robot the design is for, plus spares */
  need: number;
  /** across every robot the design is for, without spares */
  base: number;
  spare: number;
  /** the mechanism it's for ("" = not filed) */
  subsystem: string;
  design: string;
  bot: string;
  vendor: string;
  url: string;
  unit_price: number | null;
  pack_size: number | null;
  status: CotsStatus;
  hardware: boolean;
  material: string;
}

type Filter = "open" | "all" | CotsStatus;

const NO_MECH = "No mechanism";
const MULTS = [
  { m: 1, mode: "none", label: "1×" },
  { m: 1.5, mode: "half", label: "1.5×" },
  { m: 2, mode: "double", label: "2×" },
] as const;

export function PartsBom({ lines, subsystems }: { lines: BomLine[]; subsystems: string[] }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [bot, setBot] = useState("");
  const [mech, setMech] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<BomLine | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // the mechanism a new line goes into
  const [deleting, setDeleting] = useState<BomLine | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [findNote, setFindNote] = useState<string | null>(null);
  const find = useFabAction(findCotsLinks, (n) => setFindNote(n ?? null));
  const missing = lines.filter((l) => !l.url || l.unit_price === null).length;
  const bulk = useFabAction(setCotsStatus, () => setPicked(new Set()));
  const bulkSpares = useFabAction(setSpares, () => setPicked(new Set()));
  const bulkMove = useFabAction(setPartsSubsystem, () => setPicked(new Set()));
  const [newMech, setNewMech] = useState<string | null>(null);
  const bots = useMemo(() => [...new Set(lines.map((l) => l.bot).filter(Boolean))].sort(), [lines]);
  /** The team's mechanisms in order, then any other names lines are filed under. */
  const mechs = useMemo(() => {
    const out = [...subsystems];
    for (const l of lines) if (l.subsystem && !out.some((s) => s.toLowerCase() === l.subsystem.toLowerCase())) out.push(l.subsystem);
    return out;
  }, [lines, subsystems]);
  const mechOf = (l: BomLine) => mechs.find((s) => s.toLowerCase() === l.subsystem.toLowerCase()) ?? NO_MECH;

  const byBot = lines.filter((l) => !bot || l.bot === bot);
  const base = byBot.filter(
    (l) => (!mech || mechOf(l) === mech) && (!q || `${l.name} ${l.part_number} ${l.vendor} ${l.description} ${l.subsystem}`.toLowerCase().includes(q.toLowerCase())),
  );
  const count = (f: Filter) => base.filter((l) => (f === "all" ? true : f === "open" ? l.status !== "have" : l.status === f)).length;
  const shown = base
    .filter((l) => (filter === "all" ? true : filter === "open" ? l.status !== "have" : l.status === filter))
    .sort(
      (a, b) =>
        Number(a.hardware) - Number(b.hardware) ||
        COTS_STATUSES.indexOf(a.status) - COTS_STATUSES.indexOf(b.status) ||
        a.vendor.localeCompare(b.vendor) ||
        a.name.localeCompare(b.name),
    );
  // one section per mechanism, in the team's order; lines not filed anywhere last
  const sections: [string, BomLine[]][] = [...mechs, NO_MECH].map((m) => [m, shown.filter((l) => mechOf(l) === m)] as [string, BomLine[]]).filter(([, rows]) => rows.length);

  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };
  function copyList() {
    const need = base.filter((l) => l.status === "needed");
    const text = need
      .map((l) => `${buyQty(l)} × ${l.name}${l.pack_size ? ` (${l.pack_size}-pack)` : ""}${l.part_number ? ` (${l.part_number})` : ""}${l.vendor ? ` — ${l.vendor}` : ""}${l.url ? ` ${l.url}` : ""}`)
      .join("\n");
    navigator.clipboard?.writeText(text).then(() => flash("list"));
  }
  /** Tab-separated, so it pastes straight into Google Sheets as columns. */
  function copySheet() {
    navigator.clipboard?.writeText(tsv(sheetRows(sections))).then(() => flash("sheet"));
  }
  function downloadCsv() {
    const header = ["Name", "Link", "Part #", "Qty", "Unit price", "Total"];
    const blob = new Blob([csv([header, ...sheetRows(sections)]) + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cots-bom-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const total = shown.reduce((s, l) => s + (l.unit_price ?? 0) * buyQty(l), 0);
  const unpriced = shown.filter((l) => l.unit_price === null).length;

  const addSheet = (
    <Sheet open={adding !== null} onClose={() => setAdding(null)} eyebrow="COTS" title="Add a bought part">
      {adding !== null && <AddLine mechs={mechs} mech={adding} bots={bots} bot={bot} onDone={() => setAdding(null)} />}
    </Sheet>
  );

  if (!lines.length) {
    return (
      <div className="flex flex-col gap-3">
        <Empty>
          No bought parts yet. Syncing a design from{" "}
          <Link href="/tracker/designs" className="underline" style={{ color: "var(--purple)" }}>
            Onshape
          </Link>{" "}
          puts its COTS parts (motors, belts, gears, bearings) and hardware here, or add one by hand.
        </Empty>
        <button type="button" className="btn btn-primary self-start" onClick={() => setAdding("")}>
          + Add part
        </button>
        {addSheet}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Things the robots need that we buy, not make. Quantities are for every robot the design is for. Not right? Move a line to the tracker with <b>We make this</b>.
      </p>

      <div className="hscroll no-scrollbar flex gap-2 -mx-4 px-4">
        {(["open", ...COTS_STATUSES, "all"] as Filter[]).map((f) => (
          <button key={f} type="button" className="tile tile-chip text-sm" data-selected={filter === f} onClick={() => setFilter(f)}>
            {f === "open" ? "Not here yet" : f === "all" ? "All" : COTS_LABEL[f]}{" "}
            <span className="mono" style={{ color: "var(--muted)" }}>
              {count(f)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {bots.length > 1 && (
          <select className="input w-auto" value={bot} onChange={(e) => setBot(e.target.value)} aria-label="Bot">
            <option value="">All bots</option>
            {bots.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        )}
        {mechs.length > 0 && (
          <select className="input w-auto" value={mech} onChange={(e) => setMech(e.target.value)} aria-label="Mechanism">
            <option value="">All mechanisms</option>
            {[...mechs, NO_MECH]
              .filter((m) => byBot.some((l) => mechOf(l) === m))
              .map((m) => (
                <option key={m}>{m}</option>
              ))}
          </select>
        )}
        <input className="input flex-1 min-w-40" placeholder="Search parts, vendors…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the BOM" />
        <button type="button" className="btn btn-primary text-sm" onClick={() => setAdding(mech === NO_MECH ? "" : mech)}>
          + Add part
        </button>
        <button type="button" className="btn btn-ghost text-sm" onClick={copyList} disabled={!count("needed")}>
          {copied === "list" ? "Copied ✓" : `Copy buy list (${count("needed")})`}
        </button>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-2 text-sm">
        <span>
          <b className="mono">{money(total)}</b> for what&apos;s shown
          {unpriced > 0 && <span style={{ color: "var(--muted)" }}> · {unpriced} without a price</span>}
        </span>
        {(findNote || find.error) && (
          <p className="w-full text-sm" style={{ color: find.error ? "var(--bad)" : "var(--muted)" }} role="status">
            {find.error ?? findNote}
          </p>
        )}
        <span className="ml-auto flex gap-2 flex-wrap">
          <button type="button" className="btn btn-ghost text-sm" onClick={() => find.call({})} disabled={find.pending || !missing} title="Looks up each part number at its vendor (WCP, AndyMark, SDS, CTRE, ThriftyBot, McMaster…)">
            {find.pending ? "Looking up…" : `Find links & prices${missing ? ` (${missing})` : ""}`}
          </button>
          <button type="button" className="btn btn-primary text-sm" onClick={copySheet} disabled={!shown.length} title="Name, Link, Part #, Qty, Unit price, Total — paste into Google Sheets">
            {copied === "sheet" ? "Copied — paste in Sheets ✓" : "Copy for Sheets"}
          </button>
          <button type="button" className="btn btn-ghost text-sm" onClick={downloadCsv} disabled={!shown.length}>
            Download CSV
          </button>
        </span>
      </div>

      {picked.size > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-2 text-sm" style={{ background: "var(--purple-soft)" }}>
          <span className="font-medium">{picked.size} picked</span>
          <button type="button" className="btn btn-primary text-sm" onClick={() => setBulkEditing(true)}>
            Edit picked…
          </button>
          {COTS_STATUSES.map((s) => (
            <button key={s} type="button" className="btn btn-ghost text-sm" disabled={bulk.pending} onClick={() => bulk.call({ ids: [...picked].join(","), status: s })}>
              Mark {COTS_LABEL[s].toLowerCase()}
            </button>
          ))}
          <button type="button" className="text-sm underline ml-auto" onClick={() => setPicked(new Set())}>
            clear
          </button>
          <div className="w-full flex flex-wrap items-center gap-2">
            <span style={{ color: "var(--muted)" }}>Spares:</span>
            {SPARE_MODES.map((m: SpareMode) => (
              <button
                key={m}
                type="button"
                className="btn btn-ghost text-sm"
                disabled={bulkSpares.pending}
                title={m === "half" ? "Order 1.5× what the robots need" : m === "double" ? "Order 2× what the robots need" : undefined}
                onClick={() => bulkSpares.call({ ids: [...picked].join(","), mode: m })}
              >
                {SPARE_LABEL[m]}
              </button>
            ))}
            {newMech === null ? (
              <select
                className="input py-1 text-sm w-auto ml-auto"
                value=""
                disabled={bulkMove.pending}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__new__") setNewMech("");
                  else if (v) bulkMove.call({ ids: [...picked].join(","), subsystem: v === NO_MECH ? "" : v });
                }}
                aria-label="Move picked lines to a mechanism"
              >
                <option value="">Move to mechanism…</option>
                {mechs.map((m) => (
                  <option key={m}>{m}</option>
                ))}
                <option value={NO_MECH}>No mechanism</option>
                <option value={"__new__"}>+ New mechanism…</option>
              </select>
            ) : (
              <form
                className="flex gap-2 ml-auto"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newMech.trim()) return;
                  bulkMove.call({ ids: [...picked].join(","), subsystem: newMech.trim() });
                  setNewMech(null);
                }}
              >
                <input className="input py-1 text-sm w-44" autoFocus placeholder="Mechanism name" value={newMech} onChange={(e) => setNewMech(e.target.value)} aria-label="New mechanism name" />
                <button type="submit" className="btn btn-primary text-sm" disabled={!newMech.trim()}>
                  Move
                </button>
                <button type="button" className="text-sm underline" onClick={() => setNewMech(null)}>
                  cancel
                </button>
              </form>
            )}
          </div>
          <ErrorText error={bulk.error ?? bulkSpares.error ?? bulkMove.error} />
        </div>
      )}

      {shown.length === 0 && <Empty>Nothing here.</Empty>}
      {shown.length > 0 && (
        <label className="flex items-center gap-2 text-sm self-start px-3">
          <input
            type="checkbox"
            checked={shown.every((l) => picked.has(l.id))}
            onChange={(e) => {
              const on = e.target.checked;
              setPicked((p) => {
                const n = new Set(p);
                for (const l of shown) {
                  if (on) n.add(l.id);
                  else n.delete(l.id);
                }
                return n;
              });
            }}
          />
          Pick all shown ({shown.length})
        </label>
      )}

      {sections.map(([title, rows]) =>
        rows.length ? (
          <section key={title}>
            <MechHead title={title} rows={rows} all={byBot.filter((l) => mechOf(l) === title)} onAdd={() => setAdding(title === NO_MECH ? "" : title)} />
            <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
              {rows.map((l) => (
                <Row
                  key={l.id}
                  l={l}
                  onEdit={() => setEditing(l)}
                  onDelete={() => setDeleting(l)}
                  picked={picked.has(l.id)}
                  onPick={() =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (n.has(l.id)) n.delete(l.id);
                      else n.add(l.id);
                      return n;
                    })
                  }
                />
              ))}
            </ul>
          </section>
        ) : null,
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} eyebrow="COTS" title={editing?.name ?? ""}>
        {editing && <EditLine key={editing.id} l={editing} mechs={mechs} onDone={() => setEditing(null)} />}
      </Sheet>
      {addSheet}
      <Sheet open={bulkEditing} onClose={() => setBulkEditing(false)} eyebrow="COTS" title={`Edit ${picked.size} line${picked.size === 1 ? "" : "s"}`}>
        {bulkEditing && (
          <BulkEdit
            ids={[...picked]}
            bots={bots}
            onDone={() => {
              setBulkEditing(false);
              setPicked(new Set());
            }}
          />
        )}
      </Sheet>
      {deleting && (
        <DeletePartSheet
          part={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => setPicked((ids) => new Set([...ids].filter((id) => id !== deleting.id)))}
        />
      )}
    </div>
  );
}

/**
 * A mechanism's heading, with how much of it to order: 1×, 1.5× or 2× what the
 * robots need (the extra goes on as spares, for every line in the mechanism).
 */
function MechHead({ title, rows, all, onAdd }: { title: string; rows: BomLine[]; all: BomLine[]; onAdd: () => void }) {
  const a = useFabAction(setSpares);
  const [want, setWant] = useState<number | null>(null);
  // shows the pick at once; the saved spares take over when the page refreshes
  const at = a.pending ? want : multiplierOf(all);
  const parts = rows.filter((l) => !l.hardware).length;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="eyebrow" style={{ color: "var(--muted)" }}>
        {title} <span className="mono">{rows.length}</span>
        {parts > 0 && parts < rows.length && (
          <span className="normal-case tracking-normal">
            {" "}
            · {parts} part{parts === 1 ? "" : "s"}, {rows.length - parts} hardware
          </span>
        )}
      </h2>
      <button type="button" className="text-xs underline" style={{ color: "var(--purple)" }} onClick={onAdd}>
        + add
      </button>
      <span className="ml-auto flex items-center gap-1 text-xs" title={`Order more of everything in ${title}: the extra is added as spares`}>
        <span style={{ color: "var(--muted)" }}>Order</span>
        {MULTS.map(({ m, mode, label }) => (
          <button
            key={m}
            type="button"
            className="tile tile-chip text-xs mono"
            style={{ padding: "2px 8px", minHeight: 0 }}
            data-selected={at === m}
            disabled={a.pending}
            aria-label={`Order ${label} for ${title}`}
            onClick={() => {
              setWant(m);
              a.call({ ids: all.map((l) => l.id).join(","), mode });
            }}
          >
            {label}
          </button>
        ))}
      </span>
      {a.error && <ErrorText error={a.error} />}
    </div>
  );
}

function MechField({ mechs, value }: { mechs: string[]; value: string }) {
  return (
    <Field label="Mechanism">
      <input name="subsystem" className="input" defaultValue={value} list="bom-mechs" placeholder="Intake, Shooter…" />
      <datalist id="bom-mechs">
        {mechs.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </Field>
  );
}

/** A bought part added by hand: what it is, where to buy it, how many, and which mechanism it's for. */
function AddLine({ mechs, mech, bots, bot, onDone }: { mechs: string[]; mech: string; bots: string[]; bot: string; onDone: () => void }) {
  const a = useFabAction(addCotsPart, onDone);
  return (
    <form className="flex flex-col gap-3" onSubmit={a.submit}>
      <Field label="Name">
        <input name="name" className="input" required autoFocus placeholder="Kraken X60" />
      </Field>
      <Field label="Link">
        <input name="url" className="input" placeholder="https://wcproducts.com/…" inputMode="url" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Part #">
          <input name="part_number" className="input mono" placeholder="WCP-1634" />
        </Field>
        <Field label="Vendor">
          <input name="vendor" className="input" placeholder="WCP, AndyMark, REV…" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Qty needed">
          <input name="quantity" type="number" min={1} className="input mono" defaultValue={1} inputMode="numeric" required />
        </Field>
        <Field label="Spares">
          <input name="spare_qty" type="number" min={0} className="input mono" defaultValue={0} inputMode="numeric" />
        </Field>
        <Field label="Unit price">
          <input name="unit_price" className="input mono" placeholder="13.99" inputMode="decimal" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MechField mechs={mechs} value={mech} />
        <Field label="Sold in packs of" hint="Blank = sold each">
          <input name="pack_size" className="input mono" placeholder="5" inputMode="numeric" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 items-end">
        <Field label="Bot">
          <input name="bot" className="input" defaultValue={bot} list="bom-bots" placeholder="Comp bot" />
          <datalist id="bom-bots">
            {bots.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" name="hardware" value="1" /> Hardware (bolts, nuts…)
        </label>
      </div>
      <ErrorText error={a.error} />
      <SubmitButton pending={a.pending} label="Add part" />
    </form>
  );
}

/**
 * One edit for every picked line. Blank fields are left as they are on each
 * line; anything filled in is set on all of them.
 */
function BulkEdit({ ids, bots, onDone }: { ids: string[]; bots: string[]; onDone: () => void }) {
  const a = useFabAction(editCotsParts, onDone);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const out: Record<string, string> = { ids: ids.join(",") };
        for (const [k, v] of fd.entries()) if (typeof v === "string" && v.trim()) out[k] = v.trim();
        if (Object.keys(out).length === 1) return a.setError("Fill in at least one field — blank ones stay as they are.");
        a.call(out);
      }}
    >
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Blank fields stay as they are on each line. Whatever you fill in is set on all {ids.length}.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Vendor">
          <input name="vendor" className="input" placeholder="Leave as is" />
        </Field>
        <Field label="Bot">
          <input name="bot" className="input" list="bom-bulk-bots" placeholder="Leave as is" />
          <datalist id="bom-bulk-bots">
            {bots.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Unit price">
          <input name="unit_price" className="input mono" placeholder="Leave as is" inputMode="decimal" />
        </Field>
        <Field label="Packs of">
          <input name="pack_size" className="input mono" placeholder="Leave as is" inputMode="numeric" />
        </Field>
        <Field label="Spares">
          <input name="spare_qty" type="number" min={0} className="input mono" placeholder="Leave as is" inputMode="numeric" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <select name="hardware" className="input" defaultValue="">
            <option value="">Leave as is</option>
            <option value="0">Part</option>
            <option value="1">Hardware (bolts, nuts…)</option>
          </select>
        </Field>
        <Field label="We make these" hint="Moves them to the tracker">
          <select name="kind" className="input" defaultValue="">
            <option value="">No, keep on COTS</option>
            {PART_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorText error={a.error} />
      <SubmitButton pending={a.pending} label={`Save ${ids.length} line${ids.length === 1 ? "" : "s"}`} />
    </form>
  );
}

function EditLine({ l, mechs, onDone }: { l: BomLine; mechs: string[]; onDone: () => void }) {
  const a = useFabAction(updatePart, onDone);
  return (
    <form className="flex flex-col gap-3" onSubmit={a.submit}>
      <input type="hidden" name="id" value={l.id} />
      <Field label="Name">
        <input name="name" className="input" defaultValue={l.name} required />
      </Field>
      <Field label="Link">
        <input name="url" className="input" defaultValue={l.url} placeholder="https://wcproducts.com/…" inputMode="url" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Part #">
          <input name="part_number" className="input mono" defaultValue={l.part_number} placeholder="WCP-1634" />
        </Field>
        <Field label="Unit price" hint="Per pack, if it comes in packs">
          <input name="unit_price" className="input mono" defaultValue={l.unit_price ?? ""} placeholder="13.99" inputMode="decimal" />
        </Field>
      </div>
      <Field label="Sold in packs of" hint={`Blank = sold each. ${l.need} needed.`}>
        <input name="pack_size" className="input mono" defaultValue={l.pack_size ?? ""} placeholder="5" inputMode="numeric" />
      </Field>
      <Field label="Vendor">
        <input name="vendor" className="input" defaultValue={l.vendor} placeholder="WCP, AndyMark, REV…" />
      </Field>
      {!l.onshape_key && (
        <Field label="Qty needed" hint="Per robot set, before spares">
          <input name="quantity" type="number" min={1} className="input mono" defaultValue={l.base} inputMode="numeric" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <MechField mechs={mechs} value={l.subsystem} />
        <Field label="Spares" hint={`On top of ${l.base} for the robots`}>
          <input name="spare_qty" type="number" min={0} className="input mono" defaultValue={l.spare} inputMode="numeric" />
        </Field>
      </div>
      <ErrorText error={a.error} />
      <SubmitButton pending={a.pending} label="Save" />
    </form>
  );
}

function Row({ l, picked, onPick, onEdit, onDelete }: { l: BomLine; picked: boolean; onPick: () => void; onEdit: () => void; onDelete: () => void }) {
  const status = useFabAction(setCotsStatus);
  const move = useFabAction(updatePart);
  const [shown, setShown] = useState(l.status);
  const cur = status.error ? l.status : shown;
  return (
    <li className="p-3 flex flex-wrap items-start gap-3" style={{ borderColor: "var(--line)", opacity: cur === "have" ? 0.65 : 1 }}>
      <input type="checkbox" className="mt-1.5" checked={picked} onChange={onPick} aria-label={`Pick ${l.name}`} />
      <span
        className="mono text-lg font-semibold w-10 text-right shrink-0"
        title={[l.pack_size && `${l.need} needed, sold ${l.pack_size} to a pack`, l.spare > 0 && `${l.base} for the robots + ${l.spare} spare`].filter(Boolean).join(" · ") || undefined}
      >
        {buyQty(l)}×
      </span>
      <div className="min-w-0 flex-1 basis-36">
        <button type="button" className="font-medium break-words text-left hover:underline" onClick={onEdit}>
          {l.name}
        </button>
        <p className="mono text-xs mt-0.5">
          {l.unit_price === null ? (
            <button type="button" className="underline" style={{ color: "var(--muted)" }} onClick={onEdit}>
              add price
            </button>
          ) : (
            <>
              {money(l.unit_price)} {l.pack_size ? `per ${l.pack_size}-pack` : "ea"} · <b>{money(l.unit_price * buyQty(l))}</b>
              {l.pack_size && (
                <span style={{ color: "var(--muted)" }}>
                  {" "}
                  · {l.need} needed
                </span>
              )}
            </>
          )}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
          {[l.part_number, l.vendor, l.bot || l.design, l.material, l.spare > 0 && `incl. ${l.spare} spare`].filter(Boolean).join(" · ")}
          {l.url && (
            <>
              {" · "}
              <a href={l.url} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--purple)" }}>
                buy ↗
              </a>
            </>
          )}
        </p>
        <ErrorText error={status.error ?? move.error} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className={`pill pill-${COTS_TONE[cur]} cursor-pointer`}
          style={{ appearance: "auto", border: 0 }}
          value={cur}
          disabled={status.pending}
          onChange={(e) => {
            const s = e.target.value as CotsStatus;
            setShown(s);
            status.call({ ids: l.id, status: s });
          }}
          aria-label={`Status of ${l.name}`}
        >
          {COTS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COTS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="input py-1 text-xs w-auto"
          style={{ minHeight: 30 }}
          value=""
          disabled={move.pending}
          onChange={(e) => e.target.value && move.call({ id: l.id, kind: e.target.value, status: "not_started" })}
          aria-label={`Move ${l.name} to the tracker`}
        >
          <option value="">We make this…</option>
          {PART_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost text-xs shrink-0" aria-label={`Edit ${l.name}`} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-danger text-xs shrink-0" aria-label={`Delete ${l.name}`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
