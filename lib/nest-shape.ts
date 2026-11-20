/**
 * True-shape sheet nesting. Each part is drawn onto a fine grid from its real
 * outline (holes stay open, so small parts can go inside big ones), grown by
 * half the gap, and slid to the lowest, then left-most, spot where it touches
 * nothing — at 0°, 90°, 180° or 270°. Parts tuck into each other's notches
 * instead of each taking up its whole bounding box.
 *
 * The grid is conservative: a cell counts as part if any of it could be, so
 * parts never end up closer than the gap.
 */

import { loopPoints, type Loop, type Pt } from "./geom";

export type Angle = 0 | 90 | 180 | 270;

/** A part outline normalised to x ∈ [0, w], y ∈ [0, h], turned by `angle` (CCW) and kept in the first quadrant. */
export function turnPoint(p: Pt, angle: Angle, w: number, h: number): Pt {
  switch (angle) {
    case 0:
      return p;
    case 90:
      return [h - p[1], p[0]];
    case 180:
      return [w - p[0], h - p[1]];
    case 270:
      return [p[1], w - p[0]];
  }
}

/** Runs of filled cells on one row: [from, to] inclusive pairs. */
type Runs = number[];

export interface Mask {
  /** cells across / along */
  mw: number;
  mh: number;
  /** filled runs per row (row 0 = lowest y) */
  rows: Runs[];
  /** distance from the mask's lower-left cell corner to the part's own lower-left, mm */
  pad: number;
}

/** Merge [a,b] pairs (inclusive) into sorted, non-overlapping runs. */
function merge(pairs: [number, number][]): Runs {
  pairs.sort((p, q) => p[0] - q[0]);
  const out: Runs = [];
  for (const [a, b] of pairs) {
    const n = out.length;
    if (n && a <= out[n - 1] + 1) out[n - 1] = Math.max(out[n - 1], b);
    else out.push(a, b);
  }
  return out;
}

/**
 * Rasterise a part (outer loop plus holes, even-odd) at cell size `c`, grown
 * by `grow` mm. The bounding box is w × h after turning.
 */
export function partMask(loops: Loop[] | null, w0: number, h0: number, angle: Angle, c: number, grow: number): Mask {
  const turned = angle === 90 || angle === 270;
  const w = turned ? h0 : w0;
  const h = turned ? w0 : h0;
  // grow by the gap, plus enough cells that two grown parts can't come closer than the gap
  // (every edge point is within half a cell diagonal of a marked cell's centre; the disk is discrete)
  const r = Math.max(0, Math.ceil(grow / c + 1.25));
  const pad = r * c;
  const mw = Math.ceil(w / c) + 2 * r;
  const mh = Math.ceil(h / c) + 2 * r;
  const polys: Pt[][] = loops?.length
    ? loops.map((l) => loopPoints(l, Math.max(0.2, c / 4)).map((p) => turnPoint(p, angle, w0, h0)))
    : [
        [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ],
      ];

  // every cell an edge passes through, so thin tips and slivers are never missed
  const edge: [number, number][][] = Array.from({ length: mh }, () => []);
  for (const poly of polys) {
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      const [x1, y1] = poly[k];
      const [x2, y2] = poly[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (c / 3)));
      for (let t = 0; t <= n; t++) {
        const ci = Math.floor((x1 + ((x2 - x1) * t) / n + pad) / c);
        const cj = Math.floor((y1 + ((y2 - y1) * t) / n + pad) / c);
        if (cj >= 0 && cj < mh && ci >= 0 && ci < mw) edge[cj].push([ci, ci]);
      }
    }
  }

  // scanline fill at each cell row's centre, then dilate
  const base: Runs[] = [];
  for (let j = 0; j < mh; j++) {
    const y = (j + 0.5) * c - pad;
    const xs: number[] = [];
    for (const poly of polys) {
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
        const [x1, y1] = poly[k];
        const [x2, y2] = poly[i];
        if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // cells whose centre lies inside [xs[i], xs[i+1]]
      const a = Math.ceil((xs[i] + pad) / c - 0.5);
      const b = Math.floor((xs[i + 1] + pad) / c - 0.5);
      if (b >= a) pairs.push([Math.max(0, a), Math.min(mw - 1, b)]);
    }
    base.push(merge([...pairs, ...edge[j]]));
  }
  const rows: Runs[] = [];
  for (let j = 0; j < mh; j++) {
    const pairs: [number, number][] = [];
    for (let dj = -r; dj <= r; dj++) {
      const src = base[j + dj];
      if (!src?.length) continue;
      const k = Math.floor(Math.sqrt(r * r - dj * dj));
      for (let i = 0; i < src.length; i += 2) pairs.push([Math.max(0, src[i] - k), Math.min(mw - 1, src[i + 1] + k)]);
    }
    rows.push(merge(pairs));
  }
  return { mw, mh, rows, pad };
}

/** Which cells of a sheet are taken. `last[j][i]` = the last taken cell ≤ i on row j, or -1. */
export class Grid {
  last: Int32Array;
  constructor(
    public W: number,
    public H: number,
  ) {
    this.last = new Int32Array(W * H).fill(-1);
  }

  /** Mark [a, b] taken on row j. */
  fill(j: number, a: number, b: number) {
    if (j < 0 || j >= this.H) return;
    a = Math.max(0, a);
    b = Math.min(this.W - 1, b);
    if (b < a) return;
    const row = j * this.W;
    for (let i = a; i <= b; i++) this.last[row + i] = i;
    // cells after the run see it until the next taken cell
    for (let i = b + 1; i < this.W && this.last[row + i] < b; i++) this.last[row + i] = b;
  }

  place(m: Mask, X: number, Y: number) {
    m.rows.forEach((runs, r) => {
      for (let k = 0; k < runs.length; k += 2) this.fill(Y + r, X + runs[k], X + runs[k + 1]);
    });
  }

  /**
   * The lowest, then left-most, spot for `m` at or after (y0, x0). Rows that
   * collided recently are checked first, and a collision jumps x straight
   * past the cell that blocked it.
   */
  find(m: Mask, y0 = 0, x0 = 0): { X: number; Y: number } | null {
    const { W, H, last } = this;
    if (m.mw > W || m.mh > H) return null;
    const order = m.rows.map((_, r) => r).filter((r) => m.rows[r].length);
    for (let Y = y0; Y + m.mh <= H; Y++) {
      let X = Y === y0 ? x0 : 0;
      while (X + m.mw <= W) {
        let jump = -1;
        for (let oi = 0; oi < order.length; oi++) {
          const r = order[oi];
          const runs = m.rows[r];
          const row = (Y + r) * W;
          for (let k = 0; k < runs.length; k += 2) {
            const hit = last[row + X + runs[k + 1]];
            if (hit >= X + runs[k]) {
              jump = hit + 1 - runs[k];
              break;
            }
          }
          if (jump >= 0) {
            // check this row first next time
            if (oi) {
              order.splice(oi, 1);
              order.unshift(r);
            }
            break;
          }
        }
        if (jump < 0) return { X, Y };
        X = Math.max(X + 1, jump);
      }
    }
    return null;
  }
}

/** Area of an outline: the biggest loop is the outside, the rest are holes. */
export function outlineArea(loops: Loop[]): number {
  const areas = loops.map((l) => {
    const p = loopPoints(l, 0.5);
    let s = 0;
    for (let i = 0, k = p.length - 1; i < p.length; k = i++) s += p[k][0] * p[i][1] - p[i][0] * p[k][1];
    return Math.abs(s / 2);
  });
  if (!areas.length) return 0;
  const outer = Math.max(...areas);
  return Math.max(0, 2 * outer - areas.reduce((x, y) => x + y, 0));
}
