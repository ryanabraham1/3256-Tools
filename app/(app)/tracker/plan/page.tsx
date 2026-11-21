import { getFabSettings, getLocations, getMaterials, getStockPieces, getUnits } from "@/lib/fab-data";
import { getDesigns, getMachines, getParts, getPartsSettings } from "@/lib/parts-data";
import { checkPart } from "@/lib/dfm";
import { BEFORE_CUT, isStockKind, needed, PLAN_STATUSES, toCut } from "@/lib/parts";
import { PartsPlan, type PlanPart, type SparePart } from "@/components/parts-plan";
import { PageHead, UnitsToggle } from "@/components/fab-ui";

export const dynamic = "force-dynamic";

/**
 * Cut plan: every part still waiting on stock, across all the designs being
 * built, checked for manufacturability and packed onto what's on the rack.
 */
export default async function PlanPage() {
  const [parts, designs, materials, pieces, locations, machines, settings, fab, units] = await Promise.all([
    getParts(),
    getDesigns(),
    getMaterials(),
    getStockPieces(),
    getLocations(),
    getMachines(),
    getPartsSettings(),
    getFabSettings(),
    getUnits(),
  ]);
  const designById = new Map(designs.map((d) => [d.id, d]));
  const matById = new Map(materials.map((m) => [m.id, m]));

  const plan: PlanPart[] = [];
  // every stock part of a design being built, to pick spares from (done ones too)
  const spareable: SparePart[] = parts
    .filter((p) => isStockKind(p.kind) && p.status !== "not_needed" && p.status !== "outsourced" && !(p.design_id && !designById.has(p.design_id)))
    .map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      subsystem: p.subsystem.trim(),
      base: p.quantity * (p.design_id ? (designById.get(p.design_id)?.copies ?? 1) : 1),
      spare: p.spare_qty,
      status: p.status,
    }));
  for (const p of parts) {
    // stock parts not cut yet, plus In Progress ones (hidden until picked in the
    // plan's status filter); SendCutSend / deburring / finished are out
    if (!isStockKind(p.kind) || !PLAN_STATUSES.includes(p.status)) continue;
    // parts of archived designs are out; parts added by hand without a design are in
    if (p.design_id && !designById.has(p.design_id)) continue;
    const copies = p.design_id ? (designById.get(p.design_id)?.copies ?? 1) : 1;
    // In Progress: moving there takes the stock off the rack (so the cut count is
    // full), so what's left is what the progress slider hasn't marked made yet
    const left = BEFORE_CUT.includes(p.status) ? toCut(p, copies) : Math.max(0, needed(p, copies) - p.done_qty);
    if (!left) continue;
    const material = p.material_id ? (matById.get(p.material_id) ?? null) : null;
    const dfm = checkPart({ part: p, material, machines, processProp: settings.onshape_process_prop, units });
    plan.push({
      id: p.id,
      name: p.name,
      bot: p.bot,
      kind: p.kind,
      status: p.status,
      design_id: p.design_id,
      toCut: left,
      spare: p.spare_qty,
      material_id: material?.id ?? null,
      material_text: p.material_text,
      length: p.size_l_mm,
      width: p.size_w_mm,
      // sheet thickness: the rack stock it's cut from beats the model's box
      thick: material?.shape === "sheet" && material.wall_mm ? material.wall_mm : p.size_t_mm,
      geometry: p.geometry ? { loops: p.geometry.loops, width: p.geometry.width, height: p.geometry.height } : null,
      dfm: {
        level: dfm.level,
        why: [...dfm.notes, ...(dfm.best?.issues ?? [])].find((i) => i.level === "fail")?.text ?? null,
        warns: (dfm.best?.issues ?? []).filter((i) => i.level === "warn").length,
        machineId: dfm.best?.machine.id ?? null,
      },
    });
  }

  return (
    <>
      <PageHead eyebrow="Fab tracker" title="Cut plan">
        <UnitsToggle units={units} />
      </PageHead>
      <PartsPlan
        parts={plan}
        spareable={spareable}
        designs={designs.map((d) => ({ id: d.id, name: d.name, copies: d.copies }))}
        materials={materials}
        pieces={pieces}
        locations={locations}
        machines={machines}
        gap={settings.nest_gap_mm}
        margin={settings.nest_margin_mm}
        kerf={fab.kerf_mm}
        units={units}
      />
    </>
  );
}
