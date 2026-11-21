/**
 * Plates that are the same part drawn more than once: a CAD model often has
 * several bodies with one name and one outline (left/right copies, patterns
 * that were made into separate parts). The machining tracker wants one row
 * with the total quantity, not one row per body.
 */
import type { FabPart, PartGeometry } from "./parts";
import { STATUSES, type JobStatus } from "./tracker";

const r = (n: number, step: number) => Math.round(n / step) * step;

/**
 * What makes two plates the same cut: name, thickness, outline size and area,
 * how many holes and how big, and whether it's half pocketed. A mirrored copy
 * matches too (it's the same DXF, flipped over).
 */
export function twinKey(name: string, thick: number | null, g: Pick<PartGeometry, "width" | "height" | "area" | "loops" | "pocketed" | "stats">): string {
  const [a, b] = [g.width, g.height].sort((x, y) => y - x);
  const holes = [...g.stats.holes].map((d) => r(d, 0.1).toFixed(1)).sort().join(",");
  return [
    name.trim().toLowerCase().replace(/\s+/g, " "),
    thick === null ? "" : r(thick, 0.1).toFixed(1),
    `${r(a, 0.1).toFixed(1)}x${r(b, 0.1).toFixed(1)}`,
    r(g.area, 1).toFixed(0),
    g.loops.length,
    holes,
    g.pocketed ? "p" : "",
  ].join("|");
}

const ORDER = STATUSES.machining;
const DONE: JobStatus[] = ["finished", "spares_finished"];

/**
 * One row from several of the same plate: the earliest stage any copy is at
 * (so nothing looks done before it is), with what's already cut / made added
 * up. Finished copies count as fully cut and made.
 */
export function foldTwins(
  rows: Pick<FabPart, "status" | "quantity" | "cut_qty" | "done_qty" | "assignees" | "spare_qty">[],
): { status: JobStatus; cut_qty: number; done_qty: number; assignees: string[]; spare_qty: number } {
  const rank = (s: JobStatus) => (ORDER.includes(s) ? ORDER.indexOf(s) : ORDER.length);
  const status = rows.map((x) => x.status).sort((a, b) => rank(a) - rank(b))[0];
  let cut = 0;
  let done = 0;
  for (const x of rows) {
    const finished = DONE.includes(x.status);
    cut += finished ? Math.max(x.cut_qty, x.quantity) : x.cut_qty;
    done += finished ? x.quantity : x.done_qty;
  }
  const assignees = [...new Map(rows.flatMap((x) => x.assignees).map((a) => [a.toLowerCase(), a])).values()];
  return { status, cut_qty: cut, done_qty: done, assignees, spare_qty: rows.reduce((s, x) => s + (x.spare_qty ?? 0), 0) };
}
