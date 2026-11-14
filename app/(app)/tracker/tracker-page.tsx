import { Suspense } from "react";
import { getMaterials, getStockPieces, getUnits } from "@/lib/fab-data";
import { fmtAmount, materialName, summarize } from "@/lib/fab";
import { getDesigns, getJoinedPeople, getParts, getPerson } from "@/lib/parts-data";
import { isMade, trackerOf } from "@/lib/parts";
import { TRACKER_LABEL, type Tracker } from "@/lib/tracker";
import { TrackerTable } from "@/components/tracker";
import { PageHead } from "@/components/fab-ui";

/** Shared by /tracker (machining) and /tracker/print: the team's tracker sheets, as parts. */
export async function TrackerPage({ tracker }: { tracker: Tracker }) {
  const [parts, designs, materials, pieces, units, person, members] = await Promise.all([
    getParts(),
    getDesigns({ includeArchived: true }),
    getMaterials(),
    getStockPieces(),
    getUnits(),
    getPerson(),
    getJoinedPeople(),
  ]);
  const archived = new Set(designs.filter((d) => d.archived).map((d) => d.id));
  // what's on the rack for each material a row is cut from
  const stock = Object.fromEntries(
    summarize(materials, pieces).map((s) => [
      s.material.id,
      { name: materialName(s.material), onHand: s.pieces.length ? `${s.pieces.length} on rack · ${fmtAmount(s.material, s.total, units)}` : "none on rack", low: s.low || !s.pieces.length },
    ]),
  );
  const copies = Object.fromEntries(designs.map((d) => [d.id, d.copies]));
  return (
    <>
      <PageHead eyebrow="Fab tracker" title={TRACKER_LABEL[tracker]} />
      <Suspense fallback={null}>
        <TrackerTable
          tracker={tracker}
          parts={parts.filter((p) => isMade(p) && trackerOf(p.kind) === tracker && !(p.design_id && archived.has(p.design_id)))}
          stock={stock}
          copies={copies}
          person={person}
          members={members}
        />
      </Suspense>
    </>
  );
}
