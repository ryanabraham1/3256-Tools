/**
 * Cut planning: put the parts waiting on stock onto the sheets and sticks the
 * rack actually has, offcuts first, and say what's still short.
 *
 * Sheets with real part outlines are nested true-shape (lib/nest-shape.ts):
 * parts fit into each other's notches and holes, turned in 90° steps. Plain
 * boxes (no outline yet) use a MaxRects packer. Both place bottom-left so the
 * unused material stays in one clean strip that can go back on the rack.
 * Sticks use best-fit decreasing with the blade kerf.
 */

import type { Loop } from "./geom";
import { Grid, outlineArea, partMask, type Angle, type Mask } from "./nest-shape";

export interface SheetItem {
  /** part id */
  id: string;
  name: string;
  w: number;
  h: number;
  /** the real outline, normalised to [0, w] × [0, h]; null = a plain box */
  loops?: Loop[] | null;
}
export interface Placement {
  id: string;
  name: string;
  /** lower-left corner of the part's box on the sheet, mm (x across the width, y along the length) */
  x: number;
  y: number;
  /** turned 90° or 270° (the box is h × w) */
  rotated: boolean;
  /** how far it's turned, counter-clockwise (missing on plans made before true-shape nesting = 0 or 90) */
  angle?: Angle;
  w: number;
  h: number;
}
export interface SheetStock {
  /** fab_pieces id; null = a new full sheet to buy */
  pieceId: string | null;
  w: number;
  l: number;
  /** areas already cut away / unusable, in nest coordinates (x across the width, y along the length) */
  zones?: { x: number; y: number; w: number; h: number }[];
}
export interface SheetPlan extends SheetStock {
  placements: Placement[];
  /** The clean rectangles left over, biggest first. */
  remaining: Leftover[];
  /** Area of parts ÷ usable area, 0–1. */
  yield: number;
}
export interface SheetNestResult {
  sheets: SheetPlan[];
  /** Parts too big for any sheet (or the machine bed). */
  tooBig: SheetItem[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** MaxRects bin, bottom-left rule. */
class Bin {
  free: Rect[];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.free = [{ x: 0, y: 0, w, h }];
  }

  find(w: number, h: number): (Rect & { rotated: boolean }) | null {
    let best: (Rect & { rotated: boolean }) | null = null;
    let bestTop = Infinity;
    let bestX = Infinity;
    for (const f of this.free) {
      for (const [ww, hh, rotated] of [
        [w, h, false],
        [h, w, true],
      ] as const) {
        if (ww <= f.w + 1e-6 && hh <= f.h + 1e-6) {
          const top = f.y + hh;
          if (top < bestTop - 1e-6 || (Math.abs(top - bestTop) < 1e-6 && f.x < bestX)) {
            best = { x: f.x, y: f.y, w: ww, h: hh, rotated };
            bestTop = top;
            bestX = f.x;
          }
        }
      }
    }
    return best;
  }

  place(r: Rect) {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
        next.push(f);
        continue;
      }
      // split the free rect around the placed one
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    // drop free rects contained in others
    this.free = next.filter(
      (a, i) => a.w > 1e-6 && a.h > 1e-6 && !next.some((b, j) => j !== i && b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h && (j < i || b.w * b.h > a.w * a.h)),
    );
  }
}

export interface SheetNestOptions {
  /** clear space between parts (tool + extra), mm */
  gap: number;
  /** keep-out around the sheet edge, mm */
  margin: number;
  /** machine bed (w ≤ l); a bigger sheet only uses this much at a time */
  bed?: { w: number; l: number } | null;
  /** size of a new sheet, for working out how many to buy */
  full?: { w: number; l: number } | null;
  /** leftovers smaller than this (either side) aren't worth keeping, mm */
  minKeep?: number;
}

/**
 * Pack `items` (one entry per copy) onto `stock`, smallest sheet first so
 * offcuts get used, then onto as many new full sheets as it takes.
 */
export function nestSheets(items: SheetItem[], stock: SheetStock[], o: SheetNestOptions): SheetNestResult {
  const { gap, margin } = o;
  const minKeep = o.minKeep ?? 50.8;
  const usable = (s: { w: number; l: number }) => {
    let w = s.w;
    let l = s.l;
    if (o.bed) {
      // line the sheet's long side up with the bed's
      w = Math.min(w, o.bed.w);
      l = Math.min(l, o.bed.l);
    }
    // parts carry half a gap on every side, so the edge margin only needs the rest
    return { w: w - 2 * margin + gap, h: l - 2 * margin + gap };
  };
  const fits = (it: SheetItem, s: { w: number; l: number }) => {
    const u = usable(s);
    const a = it.w + gap;
    const b = it.h + gap;
    return (a <= u.w && b <= u.h) || (b <= u.w && a <= u.h);
  };

  const queue = [...items].sort((a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h));
  const biggest = [...stock, ...(o.full ? [{ pieceId: null, ...o.full }] : [])];
  const tooBig = queue.filter((it) => !biggest.some((s) => fits(it, s)));
  let left = queue.filter((it) => !tooBig.includes(it));

  const plans: SheetPlan[] = [];
  const fill = (s: SheetStock): SheetPlan | null => {
    if (left.some((it) => it.loops?.length)) return shapeFill(s);
    const u = usable(s);
    if (u.w <= 0 || u.h <= 0) return null;
    const bin = new Bin(u.w, u.h);
    // parts keep a full gap clear of areas already cut away
    for (const z of s.zones ?? []) bin.place({ x: z.x - margin, y: z.y - margin, w: z.w + gap, h: z.h + gap });
    const placements: Placement[] = [];
    const rest: SheetItem[] = [];
    for (const it of left) {
      const spot = bin.find(it.w + gap, it.h + gap);
      if (!spot) {
        rest.push(it);
        continue;
      }
      bin.place(spot);
      placements.push({
        id: it.id,
        name: it.name,
        x: margin + spot.x,
        y: margin + spot.y,
        rotated: spot.rotated,
        angle: spot.rotated ? 90 : 0,
        w: spot.rotated ? it.h : it.w,
        h: spot.rotated ? it.w : it.h,
      });
    }
    if (!placements.length) return null;
    left = rest;
    // leftover strips only make sense on a sheet with nothing cut out of it yet
    return { ...s, placements, remaining: s.zones?.length ? [] : leftovers(s, placements, gap, minKeep), yield: yieldOf(placements, u) };
  };

  // true-shape: each part drawn on a grid from its outline, slid bottom-left
  const byId = new Map(items.map((it) => [it.id, it]));
  const masks = new Map<string, Mask>();
  const areas = new Map<string, number>();
  const areaOf = (it: SheetItem) => {
    if (!it.loops?.length) return it.w * it.h;
    if (!areas.has(it.id)) areas.set(it.id, outlineArea(it.loops) || it.w * it.h);
    return areas.get(it.id)!;
  };
  const shapeFill = (s: SheetStock): SheetPlan | null => {
    const W = o.bed ? Math.min(s.w, o.bed.w) : s.w;
    const L = o.bed ? Math.min(s.l, o.bed.l) : s.l;
    // the grid runs half a gap past the margin: every part is grown by half a gap
    const o0 = margin - gap / 2;
    const ew = W - 2 * margin + gap;
    const el = L - 2 * margin + gap;
    if (ew <= 0 || el <= 0) return null;
    const c = Math.min(2, Math.max(0.5, Math.max(ew, el) / 1400));
    const grid = new Grid(Math.floor(ew / c), Math.floor(el / c));
    for (const z of s.zones ?? []) {
      const x0 = Math.floor((z.x - gap / 2 - o0) / c);
      const x1 = Math.ceil((z.x + z.w + gap / 2 - o0) / c) - 1;
      for (let j = Math.floor((z.y - gap / 2 - o0) / c); j <= Math.ceil((z.y + z.h + gap / 2 - o0) / c) - 1; j++) grid.fill(j, x0, x1);
    }
    const maskOf = (it: SheetItem, a: Angle) => {
      const k = `${it.id}|${a}|${c}`;
      if (!masks.has(k)) masks.set(k, partMask(it.loops ?? null, it.w, it.h, a, c, gap / 2));
      return masks.get(k)!;
    };
    // a copy of the same part can't fit anywhere an earlier copy didn't: resume from there
    const resume = new Map<string, { X: number; Y: number }>();
    const placements: Placement[] = [];
    const rest: SheetItem[] = [];
    for (const it of left) {
      const angles: Angle[] = it.loops?.length ? [0, 90, 180, 270] : [0, 90];
      let best: { a: Angle; m: Mask; X: number; Y: number } | null = null;
      for (const a of angles) {
        const m = maskOf(it, a);
        const k = `${it.id}|${a}`;
        const from = resume.get(k) ?? { X: 0, Y: 0 };
        const spot = from.Y >= grid.H ? null : grid.find(m, from.Y, from.X);
        resume.set(k, spot ?? { X: 0, Y: grid.H });
        if (!spot) continue;
        // lowest top edge, then left-most: keeps the used area to one end
        const top = (spot.Y + m.mh) * c;
        if (!best || top < (best.Y + best.m.mh) * c - 1e-6 || (Math.abs(top - (best.Y + best.m.mh) * c) < 1e-6 && spot.X < best.X)) best = { a, m, ...spot };
      }
      if (!best) {
        rest.push(it);
        continue;
      }
      grid.place(best.m, best.X, best.Y);
      const turned = best.a === 90 || best.a === 270;
      placements.push({
        id: it.id,
        name: it.name,
        x: o0 + best.X * c + best.m.pad,
        y: o0 + best.Y * c + best.m.pad,
        rotated: turned,
        angle: best.a,
        w: turned ? it.h : it.w,
        h: turned ? it.w : it.h,
      });
    }
    if (!placements.length) return null;
    left = rest;
    const used = placements.reduce((t, p) => t + areaOf(byId.get(p.id)!), 0);
    const room = Math.max(1, (W - 2 * margin) * (L - 2 * margin));
    return { ...s, placements, remaining: s.zones?.length ? [] : leftovers(s, placements, gap, minKeep), yield: Math.min(1, used / room) };
  };

  for (const s of [...stock].sort((a, b) => a.w * a.l - b.w * b.l)) {
    if (!left.length) break;
    const p = fill(s);
    if (p) plans.push(p);
  }
  let guard = 0;
  while (left.length && o.full && guard++ < 200) {
    const p = fill({ pieceId: null, ...o.full });
    if (!p) break;
    plans.push(p);
  }
  return { sheets: plans, tooBig: [...tooBig, ...left] };
}

function yieldOf(ps: Placement[], u: { w: number; h: number }) {
  const used = ps.reduce((s, p) => s + p.w * p.h, 0);
  return Math.min(1, used / Math.max(1, u.w * u.h));
}

export interface Leftover {
  /** as it goes back on the rack, w ≤ l */
  w: number;
  l: number;
  /** where it sits on the sheet (x across the width, y along the length) */
  at: { x: number; y: number; w: number; h: number };
}

/**
 * What goes back on the rack: the strip past the last part along the length,
 * and the strip beside the parts across the width. Pieces under `minKeep` on
 * a side are scrap.
 */
export function leftovers(s: { w: number; l: number }, ps: Placement[], gap: number, minKeep: number): Leftover[] {
  const top = Math.max(...ps.map((p) => p.y + p.h)) + gap;
  const right = Math.max(...ps.map((p) => p.x + p.w)) + gap;
  const out: Leftover[] = [];
  const cands = [
    { x: 0, y: top, w: s.w, h: s.l - top },
    { x: right, y: 0, w: s.w - right, h: Math.min(top, s.l) },
  ];
  for (const r of cands) {
    if (r.w >= minKeep && r.h >= minKeep) out.push({ w: Math.min(r.w, r.h), l: Math.max(r.w, r.h), at: r });
  }
  return out.sort((a, b) => b.w * b.l - a.w * a.l);
}

// ── Sticks ───────────────────────────────────────────────────────────────────

export interface StickItem {
  id: string;
  name: string;
  len: number;
}
export interface StickStock {
  pieceId: string | null;
  len: number;
}
export interface StickPlan extends StickStock {
  cuts: StickItem[];
  /** length left after the cuts and kerfs */
  leftover: number;
}
export interface StickNestResult {
  sticks: StickPlan[];
  tooBig: StickItem[];
}

/** Length a set of cuts takes out of a stick: every cut loses a kerf. */
export const stickUse = (cuts: { len: number }[], kerf: number) => cuts.reduce((s, c) => s + c.len, 0) + cuts.length * kerf;

/**
 * Best-fit decreasing: each cut goes where it leaves the least behind, trying
 * sticks already being cut first, then the shortest unused stick that fits
 * (offcuts before full sticks), then a new full stick.
 */
export function nestSticks(items: StickItem[], stock: StickStock[], kerf: number, full: number | null): StickNestResult {
  const open: StickPlan[] = [];
  const unused = [...stock].sort((a, b) => a.len - b.len);
  const tooBig: StickItem[] = [];
  // the last cut on a stick can run to the very end, so it doesn't need its kerf
  const fitsIn = (p: StickPlan, it: StickItem) => stickUse([...p.cuts, it], kerf) - kerf <= p.len + 0.5;

  for (const it of [...items].sort((a, b) => b.len - a.len)) {
    let best: StickPlan | null = null;
    for (const p of open) {
      if (fitsIn(p, it) && (!best || p.len - stickUse(p.cuts, kerf) < best.len - stickUse(best.cuts, kerf))) best = p;
    }
    if (!best) {
      const i = unused.findIndex((s) => it.len <= s.len + 0.5);
      if (i >= 0) {
        best = { ...unused[i], cuts: [], leftover: unused[i].len };
        unused.splice(i, 1);
        open.push(best);
      } else if (full && it.len <= full + 0.5) {
        best = { pieceId: null, len: full, cuts: [], leftover: full };
        open.push(best);
      }
    }
    if (!best) {
      tooBig.push(it);
      continue;
    }
    best.cuts.push(it);
  }
  for (const p of open) p.leftover = Math.max(0, p.len - stickUse(p.cuts, kerf));
  // stock first (in rack order), then the ones to buy
  open.sort((a, b) => Number(a.pieceId === null) - Number(b.pieceId === null) || a.len - b.len);
  return { sticks: open, tooBig };
}

// ── Back to the rack's coordinates ───────────────────────────────────────────

/**
 * The rack stores a sheet's unusable zones with x along the length and y
 * across the width; the nester works the other way round. These convert.
 */
export const zoneToNest = (z: { x: number; y: number; w: number; h: number }) => ({ x: z.y, y: z.x, w: z.h, h: z.w });

/** Placed parts (plus half the gap around each, where the bit went) as rack zones. */
export function placementZones(ps: Placement[], gap: number): { x: number; y: number; w: number; h: number }[] {
  const r = (n: number) => Math.round(n * 100) / 100;
  return ps.map((p) => ({ x: r(p.y - gap / 2), y: r(p.x - gap / 2), w: r(p.h + gap), h: r(p.w + gap) }));
}
