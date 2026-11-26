"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { commitSheet, commitStick, markPlanInProgress, setNestGap, setSpares } from "@/app/parts-actions";
import { addOrder } from "@/app/fab-actions";
import { isSheet, materialName, type FabLocation, type FabMaterial, type FabPiece } from "@/lib/fab";
import { BEFORE_CUT, KIND_LABEL, PLAN_STATUSES, SPARE_LABEL, SPARE_MODES, thickLabel, type FabMachine, type PartKind } from "@/lib/parts";
import { makeZip } from "@/lib/zip";
import { STATUS_LABEL, STATUSES, type JobStatus } from "@/lib/tracker";
import { layerName, placeLoop, svgPath, writeDxf, type Loop } from "@/lib/geom";
import { nestSheets, nestSticks, zoneToNest, type SheetPlan, type StickPlan } from "@/lib/nest";
import type { Level } from "@/lib/dfm";
import { fmtLength, fmtRect, type Units } from "@/lib/units";
import { Empty } from "./ui";
import { ErrorText, LengthInput, useFabAction } from "./fab-ui";
import { ConfirmButton } from "./confirm-button";

export interface PlanPart {
  id: string;
  name: string;
  bot: string;
  kind: PartKind;
  status: JobStatus;
  design_id: string | null;
  toCut: number;
  /** spares included in the count */
  spare: number;
  material_id: string | null;
  material_text: string;
  length: number | null;
  width: number | null;
  /** sheet thickness, mm */
  thick: number | null;
  geometry: { loops: Loop[]; width: number; height: number } | null;
  dfm: { level: Level; why: string | null; warns: number; machineId: string | null };
}

/** A stock part spares can be added to, cut or not. */
export interface SparePart {
  id: string;
  name: string;
  bot: string;
  subsystem: string;
  /** needed on the robots (quantity × copies), without spares */
  base: number;
  spare: number;
  status: JobStatus;
}

interface Group {
  material: FabMaterial;
  parts: PlanPart[];
  sheet?: {
    plans: SheetPlan[];
    tooBig: { id: string; name: string }[];
    skippedCutouts: number;
    machine: FabMachine | null;
    /** edge to edge between parts: the extra space plus the bit */
    gap: number;
    margin: number;
    /** the extra space on top of the bit, and whether it's this material's own */
    extra: number;
    custom: boolean;
  };
  stick?: { plans: StickPlan[]; tooBig: { id: string; name: string }[] };
  /** new stock to buy */
  buy: number;
}

export function PartsPlan({
  parts,
  spareable,
  designs,
  materials,
  pieces,
  locations,
  machines,
  gap,
  margin,
  kerf,
  units,
}: {
  parts: PlanPart[];
  spareable: SparePart[];
  designs: { id: string; name: string; copies: number }[];
  materials: FabMaterial[];
  pieces: FabPiece[];
  locations: FabLocation[];
  machines: FabMachine[];
  gap: number;
  margin: number;
  kerf: number;
  units: Units;
}) {
  const [off, setOff] = useState<Set<string>>(new Set()); // designs left out
  const [skip, setSkip] = useState<Set<string>>(new Set()); // parts left out
  const [useWarn, setUseWarn] = useState(true);
  // statuses shown: everything still waiting on stock (In Progress included)
  const [shown, setShown] = useState<Set<JobStatus>>(new Set(PLAN_STATUSES));
  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const locName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const designName = useMemo(() => new Map(designs.map((d) => [d.id, d.name])), [designs]);
  // where each rack piece is, so the plan says which cart to pull from
  const where = useMemo(() => new Map(pieces.map((p) => [p.id, p.location_id ? (locName.get(p.location_id) ?? "") : ""])), [pieces, locName]);

  const byStatus = new Map<JobStatus, number>();
  for (const p of parts) if (!(p.design_id && off.has(p.design_id))) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + p.toCut);
  // workflow order, just the statuses that have parts
  const statusChips = STATUSES.machining.filter((st) => PLAN_STATUSES.includes(st) && byStatus.has(st));
  const inScope = parts.filter((p) => !(p.design_id && off.has(p.design_id)) && shown.has(p.status));
  const cantMake = inScope.filter((p) => p.dfm.level === "fail");
  const risky = inScope.filter((p) => p.dfm.level === "warn");
  const noMaterial = inScope.filter((p) => p.dfm.level !== "fail" && !p.material_id);
  const planned = inScope.filter((p) => p.dfm.level !== "fail" && p.material_id && !skip.has(p.id) && (useWarn || p.dfm.level !== "warn"));

  // true-shape nesting is real work: only redo it when what's being planned changes
  const plannedKey = planned.map((p) => `${p.id}:${p.toCut}`).join(",");
  const groups: Group[] = useMemo(() => {
    // one group per stock material — and for sheet parts, per machine, so router
    // and xTool parts each get sheets laid out for that machine's bed and bit
    const by = new Map<string, PlanPart[]>();
    for (const p of planned) {
      const mat = matById.get(p.material_id!);
      const key = `${p.material_id}|${mat && isSheet(mat) ? (p.dfm.machineId ?? "") : ""}`;
      const list = by.get(key) ?? [];
      list.push(p);
      by.set(key, list);
    }
    const out: Group[] = [];
    // a piece one group plans to cut isn't offered to the next group
    const taken = new Set<string>();
    for (const [key, ps] of by) {
      const [mid, machineId] = key.split("|");
      const material = matById.get(mid);
      if (!material) continue;
      const stock = pieces.filter((x) => x.material_id === mid && !taken.has(x.id));
      if (isSheet(material)) {
        const machine = machineId ? (machineById.get(machineId) ?? null) : null;
        // this material's own spacing (thick plate on the router wants room for tabs), else the team's
        const extra = material.nest_gap_mm ?? gap;
        const g = extra + (machine?.tool_diameter_mm ?? 0);
        // the router needs an edge clear for clamps; a laser doesn't
        const edge = Math.max(margin, machine?.workhold_mm ?? 0);
        const items = ps.flatMap((p) => {
          const w = p.geometry?.width ?? p.width;
          const h = p.geometry?.height ?? p.length;
          if (!w || !h) return [];
          return Array.from({ length: p.toCut }, () => ({ id: p.id, name: p.name, w, h, loops: p.geometry?.loops ?? null }));
        });
        // part-cut sheets are fine as long as the rack knows where the cuts are
        const clean = stock.filter((s) => s.width_mm && (!s.has_cutouts || s.dead_zones.length > 0));
        const res = nestSheets(
          items,
          clean.map((s) => ({ pieceId: s.id, w: s.width_mm!, l: s.length_mm, zones: s.dead_zones.map(zoneToNest) })),
          {
            gap: g,
            margin: edge,
            bed: machine?.bed_w_mm && machine.bed_l_mm ? { w: machine.bed_w_mm, l: machine.bed_l_mm } : null,
            full: material.full_width_mm && material.full_length_mm ? { w: material.full_width_mm, l: material.full_length_mm } : null,
          },
        );
        for (const sh of res.sheets) if (sh.pieceId) taken.add(sh.pieceId);
        out.push({
          material,
          parts: ps,
          sheet: { plans: res.sheets, tooBig: res.tooBig, skippedCutouts: stock.length - clean.length, machine, gap: g, margin: edge, extra, custom: material.nest_gap_mm != null },
          buy: res.sheets.filter((s) => s.pieceId === null).length,
        });
      } else {
        const items = ps.flatMap((p) => (p.length ? Array.from({ length: p.toCut }, () => ({ id: p.id, name: p.name, len: p.length! })) : []));
        const res = nestSticks(
          items,
          stock.map((s) => ({ pieceId: s.id, len: s.length_mm })),
          kerf,
          material.full_length_mm,
        );
        for (const st of res.sticks) if (st.pieceId) taken.add(st.pieceId);
        out.push({ material, parts: ps, stick: { plans: res.sticks, tooBig: res.tooBig }, buy: res.sticks.filter((s) => s.pieceId === null).length });
      }
    }
    return out.sort((a, b) => b.buy - a.buy || materialName(a.material).localeCompare(materialName(b.material)));
    // `planned` is rebuilt every render; its key says when it changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedKey, matById, machineById, pieces, gap, margin, kerf]);

  const totalCopies = planned.reduce((s, p) => s + p.toCut, 0);
  const fromStock = groups.reduce((s, g) => s + (g.sheet?.plans ?? g.stick?.plans ?? []).filter((x) => x.pieceId).length, 0);
  const toBuy = groups.filter((g) => g.buy > 0);
  const project = designs
    .filter((d) => !off.has(d.id) && planned.some((p) => p.design_id === d.id))
    .map((d) => d.name)
    .join(", ");

  if (!parts.length) {
    return (
      <div className="parts-plan flex flex-col gap-4">
        <Empty>
          Nothing is waiting on stock. Parts show up here while they&apos;re in the first column(s) of the Plate, Tube &amp; bar or Shaft boards.{" "}
          <Link href="/tracker/board" className="underline" style={{ color: "var(--purple)" }}>
            Open the board →
          </Link>
        </Empty>
        {spareable.length > 0 && <SparesPanel parts={spareable} />}
      </div>
    );
  }

  return (
    <div className="parts-plan flex flex-col gap-4">
      {/* Scope */}
      <section className="card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="label mb-0">Designs</span>
          {designs.map((d) => (
            <button
              key={d.id}
              type="button"
              className="tile tile-chip text-sm"
              data-selected={!off.has(d.id)}
              onClick={() => setOff((s) => toggle(s, d.id))}
            >
              {d.name}
              {d.copies > 1 && ` ×${d.copies}`}
            </button>
          ))}
        </div>
        {statusChips.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="label mb-0">Status</span>
            {statusChips.map((st) => (
              <button
                key={st}
                type="button"
                className="tile tile-chip text-sm"
                data-selected={shown.has(st)}
                onClick={() => setShown((s) => toggle(s, st))}
              >
                {STATUS_LABEL[st]} <span className="mono" style={{ color: "var(--muted)" }}>{byStatus.get(st)}</span>
              </button>
            ))}
          </div>
        )}
        {shown.has("in_progress") && byStatus.has("in_progress") && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            In Progress parts show here until their stock comes off the rack (&ldquo;Mark cut&rdquo;). Moving one to In Progress on the board takes its stock right away, so it drops off.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Big label="Parts to cut" value={`${totalCopies}`} sub={`${planned.length} different`} />
          <Big label="From the rack" value={`${fromStock}`} sub="sheets / sticks" tone="good" />
          <Big label="To buy" value={`${toBuy.reduce((s, g) => s + g.buy, 0)}`} sub={toBuy.length ? toBuy.map((g) => g.material.material).join(", ") : "enough on hand"} tone={toBuy.length ? "bad" : "good"} />
          <Big label="Can't make" value={`${cantMake.length}`} sub={noMaterial.length ? `+ ${noMaterial.length} with no stock match` : "with our machines"} tone={cantMake.length ? "bad" : undefined} />
        </div>
        {risky.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useWarn} onChange={(e) => setUseWarn(e.target.checked)} />
            Include {risky.length} part{risky.length > 1 ? "s" : ""} with DFM warnings (sharp corners, small holes…)
          </label>
        )}
      </section>

      {spareable.length > 0 && <SparesPanel parts={spareable} />}

      <DxfsByThickness parts={inScope.filter((p) => p.dfm.level !== "fail" && !skip.has(p.id) && (useWarn || p.dfm.level !== "warn"))} materials={matById} />

      {(cantMake.length > 0 || noMaterial.length > 0) && (
        <section className="card p-4 flex flex-col gap-2">
          <h2 className="text-xl font-medium tracking-tight">Needs attention first</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {cantMake.map((p) => (
              <li key={p.id} className="plan-attention-row flex gap-2">
                <span className="pill pill-bad shrink-0">Can&apos;t make</span>
                <Link prefetch={false} href={`/tracker/${p.id}`} className="underline font-medium">
                  {p.name}
                </Link>
                <span style={{ color: "var(--muted)" }}>{p.dfm.why}</span>
              </li>
            ))}
            {noMaterial.map((p) => (
              <li key={p.id} className="plan-attention-row flex gap-2">
                <span className="pill pill-warn shrink-0">No stock</span>
                <Link prefetch={false} href={`/tracker/${p.id}`} className="underline font-medium">
                  {p.name}
                </Link>
                <span style={{ color: "var(--muted)" }}>
                  {p.material_text || "No material"} — nothing on the rack matches. Pick one on the part, or{" "}
                  <Link href="/stock/new" className="underline">
                    add the material
                  </Link>
                  .
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.map((g) => (
        <MaterialGroup
          key={`${g.material.id}-${g.sheet?.machine?.id ?? ""}`}
          g={g}
          units={units}
          where={where}
          project={project}
          designName={designName}
          defaultGap={gap}
          onSkip={(id) => setSkip((s) => toggle(s, id))}
        />
      ))}

      {skip.size > 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {skip.size} part{skip.size > 1 ? "s" : ""} left out of the plan ·{" "}
          <button type="button" className="underline" onClick={() => setSkip(new Set())}>
            put back
          </button>
        </p>
      )}
    </div>
  );
}

const NO_SUB = "No subsystem";

/**
 * Pick parts (or a whole subsystem) to cut spares of: +1 each, 1.5× or 2× what
 * the robots need. Parts already made go back to Spares Needed, so just the
 * extra copies land in the plan.
 */
function SparesPanel({ parts }: { parts: SparePart[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const a = useFabAction(setSpares, (n) => {
    setNote(n ? `Updated ${n} part${n === 1 ? "" : "s"}` : "No change");
    setPicked(new Set());
  });
  const shown = parts.filter((p) => !q || `${p.name} ${p.subsystem} ${p.bot}`.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, SparePart[]>();
  for (const p of [...shown].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }))) {
    const k = p.subsystem || NO_SUB;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const withSpares = parts.filter((p) => p.spare > 0).length;

  return (
    <details className="card p-4">
      <summary className="cursor-pointer flex flex-wrap items-baseline gap-2">
        <span className="text-xl font-medium tracking-tight">Cut spares</span>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Pick parts to cut extras of{withSpares > 0 && ` · ${withSpares} have spares now`}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <input className="input" placeholder="Search parts, subsystems…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search parts for spares" />
        <div className="flex flex-wrap items-center gap-2 text-sm sticky top-0 py-1" style={{ background: "var(--surface)", zIndex: 1 }}>
          <span className="font-medium">{picked.size} picked</span>
          {SPARE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={m === "plus1" ? "btn btn-primary text-sm" : "btn btn-ghost text-sm"}
              disabled={!picked.size || a.pending}
              title={m === "half" ? "Cut 1.5× what the robots need" : m === "double" ? "Cut 2× what the robots need" : undefined}
              onClick={() => {
                setNote(null);
                a.call({ ids: [...picked].join(","), mode: m });
              }}
            >
              {SPARE_LABEL[m]}
            </button>
          ))}
          {picked.size > 0 && (
            <button type="button" className="text-sm underline" onClick={() => setPicked(new Set())}>
              clear
            </button>
          )}
          {note && !a.error && (
            <span role="status" style={{ color: "var(--muted)" }}>
              {note}
            </span>
          )}
          <ErrorText error={a.error} />
        </div>
        <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
          {[...groups].map(([sub, ps]) => {
            const all = ps.every((p) => picked.has(p.id));
            return (
              <div key={sub}>
                <label className="eyebrow flex items-center gap-2 mb-1" style={{ color: "var(--muted)" }}>
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        for (const p of ps) {
                          if (all) n.delete(p.id);
                          else n.add(p.id);
                        }
                        return n;
                      })
                    }
                    aria-label={`Pick all of ${sub}`}
                  />
                  {sub} <span className="mono">{ps.length}</span>
                </label>
                <ul className="flex flex-col gap-1 text-sm">
                  {ps.map((p) => (
                    <li key={p.id}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => setPicked((s) => toggle(s, p.id))} />
                        <span className="min-w-0 truncate">{p.name}</span>
                        <span className="mono text-xs shrink-0" style={{ color: "var(--muted)" }}>
                          {p.base}
                          {p.spare > 0 && <b style={{ color: "var(--purple)" }}> +{p.spare} spare</b>}
                        </span>
                        <span className="text-xs ml-auto shrink-0" style={{ color: "var(--muted)" }}>
                          {BEFORE_CUT.includes(p.status) ? "" : STATUS_LABEL[p.status]}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!shown.length && <p className="text-sm" style={{ color: "var(--muted)" }}>No parts match.</p>}
        </div>
      </div>
    </details>
  );
}

/**
 * One zip per sheet thickness holding every plate's own outline DXF (named
 * with how many to cut), for laying out by hand in the machine's software.
 */
function DxfsByThickness({ parts, materials }: { parts: PlanPart[]; materials: Map<string, FabMaterial> }) {
  const byThick = new Map<string, PlanPart[]>();
  for (const p of parts) {
    if (p.kind !== "plate" || !p.geometry || p.thick === null) continue;
    const k = thickLabel(p.thick).replace(/ thick$/, "");
    byThick.set(k, [...(byThick.get(k) ?? []), p]);
  }
  const noOutline = parts.filter((p) => p.kind === "plate" && !p.geometry).length;
  if (!byThick.size) return null;
  const sorted = [...byThick].sort((a, b) => a[1][0].thick! - b[1][0].thick!);

  function download(label: string, ps: PlanPart[]) {
    const mats = new Set(ps.map((p) => p.material_id ?? ""));
    const files = ps.map((p) => {
      const g = p.geometry!;
      const text = writeDxf([
        { name: "OUTLINE", loops: g.loops.slice(0, 1), color: 7 },
        { name: "HOLES", loops: g.loops.slice(1), color: 1 },
      ]);
      const mat = p.material_id ? materials.get(p.material_id) : undefined;
      // more than one material at this thickness: a folder each, so they aren't cut together
      const folder = mats.size > 1 ? `${safeFile(mat ? materialName(mat) : p.material_text || "No material")}/` : "";
      return { name: `${folder}${safeFile(p.name)} x${p.toCut}.dxf`, text };
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([makeZip(files)], { type: "application/zip" }));
    a.download = `plates-${label.replace(/"/g, "in").replace(/\//g, "-")}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return (
    <section className="card p-4 flex flex-col gap-2">
      <h2 className="text-xl font-medium tracking-tight">Part DXFs by thickness</h2>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Every plate&apos;s own outline, one file each, named with how many to cut.
      </p>
      <div className="flex flex-wrap gap-2">
        {sorted.map(([label, ps]) => (
          <button key={label} type="button" className="btn btn-ghost text-sm" onClick={() => download(label, ps)}>
            Download {label} <span className="mono" style={{ color: "var(--muted)" }}>· {ps.length} part{ps.length > 1 ? "s" : ""}</span>
          </button>
        ))}
      </div>
      {noOutline > 0 && (
        <p className="text-xs" style={{ color: "var(--warn)" }}>
          {noOutline} plate{noOutline > 1 ? "s" : ""} with no outline yet left out — upload a DXF on the part or re-sync.
        </p>
      )}
    </section>
  );
}

const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim() || "part";

function toggle<T>(s: Set<T>, id: T): Set<T> {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg p-3" style={{ background: tone ? `var(--${tone}-soft)` : "var(--paper)" }}>
      <p className="label" style={{ color: tone ? `var(--${tone})` : undefined }}>
        {label}
      </p>
      <p className="mono text-3xl font-semibold">{value}</p>
      <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
        {sub}
      </p>
    </div>
  );
}

function MaterialGroup({
  g,
  units,
  where,
  project,
  designName,
  defaultGap,
  onSkip,
}: {
  g: Group;
  units: Units;
  where: Map<string, string>;
  project: string;
  designName: Map<string, string>;
  defaultGap: number;
  onSkip: (id: string) => void;
}) {
  const m = g.material;
  const buy = useFabAction(addOrder);
  const [ordered, setOrdered] = useState(false);
  const tooBig = g.sheet?.tooBig ?? g.stick?.tooBig ?? [];
  const copies = g.parts.reduce((s, p) => s + p.toCut, 0);
  const geomById = new Map(g.parts.map((p) => [p.id, p.geometry]));
  const statusById = new Map(g.parts.map((p) => [p.id, p.status]));
  const noSize = g.parts.filter((p) => (g.sheet ? !(p.geometry || (p.width && p.length)) : !p.length));

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="eyebrow" style={{ color: "var(--muted)" }}>
            {copies} part{copies === 1 ? "" : "s"}
            {g.sheet?.machine && ` · on the ${g.sheet.machine.name}`}
          </p>
          <Link href={`/stock/${m.id}`} className="text-2xl font-medium tracking-tight hover:underline">
            {materialName(m)}
          </Link>
        </div>
        {g.buy > 0 ? (
          <div className="flex flex-col items-end gap-1">
            <span className="pill pill-bad">
              Short · buy {g.buy} {isSheet(m) ? "sheet" : "stick"}
              {g.buy > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              className="btn btn-ghost text-sm"
              disabled={buy.pending || ordered}
              onClick={() => {
                buy.call({ material_id: m.id, quantity: String(g.buy), notes: `Cut plan: ${project}`.slice(0, 200) });
                setOrdered(true);
              }}
            >
              {ordered && !buy.error ? "On the shopping list ✓" : "Add to shopping list"}
            </button>
            <ErrorText error={buy.error} />
          </div>
        ) : (
          <span className="pill pill-good">Enough on the rack</span>
        )}
      </div>

      {g.sheet && <Spacing m={m} sheet={g.sheet} defaultGap={defaultGap} units={units} />}

      {tooBig.length > 0 && (
        <p className="text-sm" style={{ color: "var(--bad)" }}>
          Too big for any {isSheet(m) ? "sheet or the machine bed" : "stick"}: {[...new Set(tooBig.map((t) => t.name))].join(", ")}
        </p>
      )}
      {noSize.length > 0 && (
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          No size, so not planned: {noSize.map((p) => p.name).join(", ")}
        </p>
      )}
      {!!g.sheet?.skippedCutouts && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {g.sheet.skippedCutouts} sheet{g.sheet.skippedCutouts > 1 ? "s" : ""} marked “has cutouts” with no marked areas left out — mark where the cuts are on the stock page to use them.
        </p>
      )}
      {!m.full_length_mm && g.buy === 0 && tooBig.length > 0 && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Set the full {isSheet(m) ? "sheet" : "stick"} size on the material to see how many to buy.
        </p>
      )}

      <div className={g.sheet ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-2"}>
        {g.sheet?.plans.map((s, i) => (
          <SheetCard key={i} m={m} s={s} n={i + 1} geomById={geomById} statusById={statusById} units={units} where={where} project={project} margin={g.sheet!.margin} gap={g.sheet!.gap} />
        ))}
        {g.stick?.plans.map((s, i) => (
          <StickCard key={i} m={m} s={s} statusById={statusById} units={units} where={where} project={project} />
        ))}
      </div>

      <details>
        <summary className="text-sm cursor-pointer" style={{ color: "var(--muted)" }}>
          Parts in this plan
        </summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {g.parts.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="mono w-8 text-right" title={p.spare ? `incl. ${p.spare} spare` : undefined}>
                ×{p.toCut}
              </span>
              <Link prefetch={false} href={`/tracker/${p.id}`} className="underline min-w-0 truncate">
                {p.name}
              </Link>
              {p.dfm.warns > 0 && <span className="pill pill-warn">check</span>}
              <span className="text-xs truncate" style={{ color: "var(--muted)" }}>
                {p.design_id ? designName.get(p.design_id) : KIND_LABEL[p.kind]}
              </span>
              <button type="button" className="text-xs underline ml-auto shrink-0" onClick={() => onSkip(p.id)}>
                leave out
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/**
 * Space between parts for this material: scale it (1.5× for router tabs on
 * thick plate) or type it. Saved on the material, so the whole team's plan
 * and the automatic stock-taking use it.
 */
function Spacing({ m, sheet, defaultGap, units }: { m: FabMaterial; sheet: NonNullable<Group["sheet"]>; defaultGap: number; units: Units }) {
  const [open, setOpen] = useState(false);
  const save = useFabAction(setNestGap, () => setOpen(false));
  const [typed, setTyped] = useState<number | null>(sheet.extra);
  const bit = sheet.gap - sheet.extra;
  const base = defaultGap + bit; // edge to edge with the team default
  const set = (extra: number | null) => save.call({ material_id: m.id, gap_mm: extra === null ? "" : String(Math.max(0, Math.round(extra * 100) / 100)) });
  const scale = base > 0 ? sheet.gap / base : 1;
  return (
    <div className="text-sm flex flex-col gap-2">
      <p style={{ color: "var(--muted)" }}>
        <span style={{ color: "var(--ink)" }}>
          {fmtLength(sheet.gap, units)} between parts
        </span>
        {bit > 0 && ` (${fmtLength(sheet.extra, units)} + ${fmtLength(bit, units)} bit)`}
        {sheet.custom && Math.abs(scale - 1) > 0.01 && ` · ${Math.round(scale * 100) / 100}× the usual`}
        {" · "}
        <button type="button" className="underline" style={{ color: "var(--purple)" }} onClick={() => setOpen(!open)}>
          {open ? "close" : "change"}
        </button>
      </p>
      {open && (
        <div className="card p-3 flex flex-col gap-2" style={{ background: "var(--paper)" }}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Scale
            </span>
            {[1, 1.5, 2, 3].map((k) => (
              <button
                key={k}
                type="button"
                className="tile tile-chip text-xs mono"
                style={{ padding: "2px 10px", minHeight: 0 }}
                data-selected={Math.abs(scale - k) < 0.01}
                disabled={save.pending}
                onClick={() => set(k === 1 ? null : base * k - bit)}
              >
                {k}×
              </button>
            ))}
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed !== null) set(typed);
            }}
          >
            <div className="flex-1">
              <LengthInput name="" label={bit > 0 ? "Or type the space (on top of the bit)" : "Or type the space"} units={units} defaultMm={sheet.extra} onChange={setTyped} />
            </div>
            <button type="submit" className="btn btn-primary text-sm" disabled={save.pending || typed === null}>
              Save
            </button>
          </form>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            For every {materialName(m)} sheet. Leave room for tabs on thick plate. Usual: {fmtLength(base, units)}.
          </p>
          <ErrorText error={save.error} />
        </div>
      )}
    </div>
  );
}

const HUES = [265, 200, 150, 30, 330, 100, 0, 60, 180, 290];

function SheetCard({
  m,
  s,
  n,
  geomById,
  statusById,
  units,
  where,
  project,
  margin,
  gap,
}: {
  m: FabMaterial;
  s: SheetPlan;
  n: number;
  geomById: Map<string, PlanPart["geometry"]>;
  statusById: Map<string, JobStatus>;
  units: Units;
  where: Map<string, string>;
  project: string;
  margin: number;
  gap: number;
}) {
  const commit = useFabAction(commitSheet);
  const ids = [...new Set(s.placements.map((p) => p.id))];
  const hue = (id: string) => HUES[ids.indexOf(id) % HUES.length];
  const counts = ids.map((id) => ({ partId: id, count: s.placements.filter((p) => p.id === id).length }));
  const placed = s.placements.map((p) => {
    const g = geomById.get(p.id);
    const loops = g
      ? g.loops.map((l) => placeLoop(l, p.angle ?? (p.rotated ? 90 : 0), g.width, g.height, p.x, p.y))
      : [rect(p.x, p.y, p.w, p.h)];
    return { ...p, loops, hasOutline: !!g };
  });
  const missingOutline = placed.filter((p) => !p.hasOutline).length;

  function download() {
    const text = writeDxf([
      { name: "SHEET", loops: [rect(0, 0, s.w, s.l)], color: 8 },
      { name: "OUTSIDE", loops: placed.filter((p) => p.hasOutline).map((p) => p.loops[0]), color: 7 },
      { name: "INSIDE", loops: placed.filter((p) => p.hasOutline).flatMap((p) => p.loops.slice(1)), color: 1 },
      ...(missingOutline ? [{ name: "NO_OUTLINE_BOXES", loops: placed.filter((p) => !p.hasOutline).map((p) => p.loops[0]), color: 2 }] : []),
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/dxf" }));
    a.download = `${layerName(`${m.material}-${fmtRect(s.w, s.l, "in")}`).replace(/\s+/g, "")}-${n}.dxf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const pad = Math.max(s.w, s.l) * 0.01;
  return (
    <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: "var(--paper)", border: s.pieceId ? "1px solid var(--line)" : "1px dashed var(--bad)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {s.pieceId ? `Sheet ${n}` : `New sheet ${n}`} · <span className="mono">{fmtRect(s.w, s.l, units)}</span>
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {s.placements.length} part{s.placements.length > 1 ? "s" : ""} · {Math.round(s.yield * 100)}% used
            {s.pieceId ? ` · ${where.get(s.pieceId) || "on the rack"}` : " · buy this one"}
          </p>
        </div>
      </div>
      <svg viewBox={`${-pad} ${-s.l - pad} ${s.w + 2 * pad} ${s.l + 2 * pad}`} className="w-full max-h-96" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Layout for sheet ${n}`}>
        <g transform="scale(1,-1)">
          <rect x={0} y={0} width={s.w} height={s.l} fill="var(--surface)" stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <rect x={margin} y={margin} width={Math.max(0, s.w - 2 * margin)} height={Math.max(0, s.l - 2 * margin)} fill="none" stroke="var(--line)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {(s.zones ?? []).map((z, i) => (
            <rect key={`z${i}`} x={z.x} y={z.y} width={z.w} height={z.h} fill="var(--line)" stroke="var(--muted)" strokeWidth={0.8} vectorEffect="non-scaling-stroke">
              <title>Already cut / unusable</title>
            </rect>
          ))}
          {s.remaining.map((r, i) => (
            <rect
              key={i}
              x={r.at.x}
              y={r.at.y}
              width={r.at.w}
              height={r.at.h}
              fill="var(--good-soft)"
              stroke="var(--good)"
              strokeDasharray="6 4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {placed.map((p, i) => (
            <path
              key={i}
              d={svgPath(p.loops)}
              fillRule="evenodd"
              fill={`hsl(${hue(p.id)} 70% 88%)`}
              stroke={`hsl(${hue(p.id)} 55% 35%)`}
              strokeWidth={1.2}
              strokeDasharray={p.hasOutline ? undefined : "5 3"}
              vectorEffect="non-scaling-stroke"
            >
              <title>{p.name}</title>
            </path>
          ))}
        </g>
      </svg>
      <ul className="flex flex-wrap gap-1.5 text-xs">
        {counts.map((c) => (
          <li key={c.partId} className="chip" style={{ background: `hsl(${hue(c.partId)} 70% 92%)`, color: `hsl(${hue(c.partId)} 55% 28%)` }}>
            {c.count}× {s.placements.find((p) => p.id === c.partId)!.name}
          </li>
        ))}
      </ul>
      {s.remaining.length > 0 && (
        <p className="text-xs" style={{ color: "var(--good)" }}>
          Back on the rack: {s.remaining.map((r) => fmtRect(r.w, r.l, units)).join(", ")}
        </p>
      )}
      {missingOutline > 0 && (
        <p className="text-xs" style={{ color: "var(--warn)" }}>
          {missingOutline} placed as a plain box — no outline yet.
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn btn-ghost text-sm" onClick={download}>
          Download DXF
        </button>
        {s.pieceId && (
          <ConfirmButton
            className="btn btn-primary text-sm"
            pending={commit.pending}
            label="Mark cut"
            message={`${s.yield > 0.85 ? "This sheet gets used up" : "The cut areas get marked unusable on this sheet"}, and ${s.placements.length} part${s.placements.length > 1 ? "s" : ""} count as cut. You can undo it from the stock log.`}
            onConfirm={() => commit.call({ plan: JSON.stringify({ pieceId: s.pieceId, w: s.w, l: s.l, placements: s.placements, yield: s.yield, gap, project }) })}
          />
        )}
        <MarkInProgress ids={ids} statusById={statusById} />
      </div>
      <ErrorText error={commit.error} />
    </div>
  );
}

/**
 * Move every part on a layout that hasn't started to In Progress (being cut
 * now). Status only: the stock comes off with "Mark cut".
 */
function MarkInProgress({ ids, statusById }: { ids: string[]; statusById: Map<string, JobStatus> }) {
  const todo = ids.filter((id) => BEFORE_CUT.includes(statusById.get(id) ?? "in_progress"));
  const a = useFabAction(markPlanInProgress);
  if (!todo.length) {
    return (
      <span className="text-xs self-center" style={{ color: "var(--muted)" }}>
        All in progress
      </span>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-ghost text-sm" disabled={a.pending} onClick={() => a.call({ ids: todo.join(",") })} title="Moves them to In Progress with you as their Fab DRI">
        {a.pending ? "Working…" : `Mark in progress${todo.length < ids.length ? ` (${todo.length})` : ""}`}
      </button>
      <ErrorText error={a.error} />
    </>
  );
}

function rect(x: number, y: number, w: number, h: number): Loop {
  return {
    segs: [
      { a: [x, y], b: [x + w, y], bulge: 0 },
      { a: [x + w, y], b: [x + w, y + h], bulge: 0 },
      { a: [x + w, y + h], b: [x, y + h], bulge: 0 },
      { a: [x, y + h], b: [x, y], bulge: 0 },
    ],
  };
}

function StickCard({
  m,
  s,
  statusById,
  units,
  where,
  project,
}: {
  m: FabMaterial;
  s: StickPlan;
  statusById: Map<string, JobStatus>;
  units: Units;
  where: Map<string, string>;
  project: string;
}) {
  const commit = useFabAction(commitStick);
  const ids = [...new Set(s.cuts.map((c) => c.id))];
  const hue = (id: string) => HUES[ids.indexOf(id) % HUES.length];
  return (
    <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: "var(--paper)", border: s.pieceId ? "1px solid var(--line)" : "1px dashed var(--bad)" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm">
          <span className="font-medium">{s.pieceId ? "Stick" : "New stick"}</span> <span className="mono">{fmtLength(s.len, units)}</span>
          <span style={{ color: "var(--muted)" }}>
            {" "}
            · {s.cuts.length} cut{s.cuts.length > 1 ? "s" : ""} · {fmtLength(s.leftover, units)} left
            {s.pieceId ? ` · ${where.get(s.pieceId) || "on the rack"}` : " · buy this one"}
          </span>
        </p>
        {s.pieceId && (
          <ConfirmButton
            className="btn btn-primary text-sm"
            pending={commit.pending}
            label="Mark cut"
            message={`${s.cuts.length} cut${s.cuts.length > 1 ? "s" : ""} come off this ${fmtLength(s.len, units)} stick, leaving ${fmtLength(s.leftover, units)}. You can undo it from the stock log.`}
            onConfirm={() => commit.call({ plan: JSON.stringify({ pieceId: s.pieceId, len: s.len, cuts: s.cuts.map((c) => ({ partId: c.id, len: c.len })), project }) })}
          />
        )}
        <MarkInProgress ids={ids} statusById={statusById} />
      </div>
      <div className="flex h-8 rounded overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--line)" }} aria-label={`${materialName(m)} cut layout`}>
        {s.cuts.map((c, i) => (
          <div
            key={i}
            className="h-full flex items-center justify-center text-[10px] mono truncate px-1"
            style={{ width: `${(c.len / s.len) * 100}%`, background: `hsl(${hue(c.id)} 70% 88%)`, color: `hsl(${hue(c.id)} 55% 28%)`, borderRight: "2px solid var(--ink)" }}
            title={`${c.name} · ${fmtLength(c.len, units)}`}
          >
            {c.name}
          </div>
        ))}
      </div>
      <ul className="flex flex-wrap gap-1.5 text-xs">
        {s.cuts.map((c, i) => (
          <li key={i} className="chip">
            {fmtLength(c.len, units)} {c.name}
          </li>
        ))}
      </ul>
      <ErrorText error={commit.error} />
    </div>
  );
}
