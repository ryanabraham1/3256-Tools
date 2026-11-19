"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { clipZones, type Zone } from "@/lib/fab";
import { MM_PER_IN } from "@/lib/units";

type Pt = { x: number; y: number };

/** Solve the 8×8 system for the homography taking `from[i]` to `to[i]`. */
export function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((r) => r[8]), 1];
}

export const apply = (h: number[], x: number, y: number): Pt => {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
};

/** Corners in order top-left, top-right, bottom-right, bottom-left (as seen in the photo). */
export function orderCorners(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const start = byAngle.reduce((best, p, i) => (p.x + p.y < byAngle[best].x + byAngle[best].y ? i : best), 0);
  return [0, 1, 2, 3].map((k) => byAngle[(start + k) % 4]);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

interface Cells {
  nx: number;
  ny: number;
  cell: number;
  /** distance of each cell from what most of the sheet looks like */
  score: Float32Array;
}

/** Score ½" cells of the straightened photo by how unlike the sheet they look. */
export function scoreCells(img: ImageData, L: number, W: number): Cells {
  const cell = MM_PER_IN / 2;
  const nx = Math.max(1, Math.round(L / cell));
  const ny = Math.max(1, Math.round(W / cell));
  const lum = new Float32Array(nx * ny);
  const chr = new Float32Array(nx * ny);
  const cw = img.width / nx;
  const ch = img.height / ny;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // the middle of the cell, so a slightly-off corner tap doesn't bleed in
      const x0 = Math.floor(i * cw + cw * 0.2);
      const x1 = Math.max(x0 + 1, Math.floor((i + 1) * cw - cw * 0.2));
      const y0 = Math.floor(j * ch + ch * 0.2);
      const y1 = Math.max(y0 + 1, Math.floor((j + 1) * ch - ch * 0.2));
      let sl = 0;
      let sc = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < img.height; y++) {
        for (let x = x0; x < x1 && x < img.width; x++) {
          const o = (y * img.width + x) * 4;
          const r = img.data[o];
          const g = img.data[o + 1];
          const b = img.data[o + 2];
          sl += 0.299 * r + 0.587 * g + 0.114 * b;
          sc += Math.max(r, g, b) - Math.min(r, g, b);
          n++;
        }
      }
      lum[j * nx + i] = n ? sl / n : 0;
      chr[j * nx + i] = n ? sc / n : 0;
    }
  }
  const mL = median([...lum]);
  const mC = median([...chr]);
  const sL = Math.max(10, 1.4826 * median([...lum].map((v) => Math.abs(v - mL))));
  const sC = Math.max(8, 1.4826 * median([...chr].map((v) => Math.abs(v - mC))));
  const score = new Float32Array(nx * ny);
  for (let k = 0; k < score.length; k++) score[k] = Math.hypot((lum[k] - mL) / sL, (chr[k] - mC) / sC);
  return { nx, ny, cell, score };
}

/**
 * Cells over the threshold → rectangles. Specks under 1" are dropped (glare,
 * scratches, a stray marker line), and what's left grows by ½" so parts keep clear of it.
 */
export function zonesFrom(c: Cells, threshold: number, L: number, W: number): Zone[] {
  const { nx, ny } = c;
  const at = (g: Uint8Array, i: number, j: number) => (i >= 0 && j >= 0 && i < nx && j < ny ? g[j * nx + i] : 0);
  const bad = new Uint8Array(nx * ny);
  for (let k = 0; k < bad.length; k++) bad[k] = c.score[k] > threshold ? 1 : 0;
  // opening with a 2×2 block: keep a cell only if some 2×2 block of bad cells covers it
  const block = new Uint8Array(nx * ny);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) block[j * nx + i] = at(bad, i, j) & at(bad, i + 1, j) & at(bad, i, j + 1) & at(bad, i + 1, j + 1);
  const kept = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) kept[j * nx + i] = at(block, i, j) | at(block, i - 1, j) | at(block, i, j - 1) | at(block, i - 1, j - 1);
  // grow by one cell
  const grown = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let v = 0;
      for (let dj = -1; dj <= 1 && !v; dj++) for (let di = -1; di <= 1 && !v; di++) v = at(kept, i + di, j + dj);
      grown[j * nx + i] = v;
    }
  // greedy rectangles: run right, then down while the whole run is bad
  const used = new Uint8Array(nx * ny);
  const out: Zone[] = [];
  const cx = L / nx;
  const cy = W / ny;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!grown[j * nx + i] || used[j * nx + i]) continue;
      let i1 = i;
      while (i1 + 1 < nx && grown[j * nx + i1 + 1] && !used[j * nx + i1 + 1]) i1++;
      let j1 = j;
      const rowOk = (r: number) => {
        for (let x = i; x <= i1; x++) if (!grown[r * nx + x] || used[r * nx + x]) return false;
        return true;
      };
      while (j1 + 1 < ny && rowOk(j1 + 1)) j1++;
      for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) used[y * nx + x] = 1;
      out.push({ x: i * cx, y: j * cy, w: (i1 - i + 1) * cx, h: (j1 - j + 1) * cy });
    }
  return clipZones(out, L, W);
}

/** Load a photo into a canvas no bigger than `max` on its long side (EXIF rotation applied by the browser). */
async function loadPhoto(file: File, max = 1600): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Straighten the sheet in the photo into an L × W picture (length across). */
function rectify(src: HTMLCanvasElement, corners: Pt[], L: number, W: number): HTMLCanvasElement {
  const [tl, tr, br, bl] = orderCorners(corners);
  // the sheet's length runs along whichever side of the photo is longer
  const lengthAcross = dist(tl, tr) + dist(bl, br) >= dist(tl, bl) + dist(tr, br);
  const sheet: Pt[] = lengthAcross
    ? [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: W },
        { x: 0, y: W },
      ]
    : [
        { x: 0, y: 0 },
        { x: 0, y: W },
        { x: L, y: W },
        { x: L, y: 0 },
      ];
  const h = homography(sheet, [tl, tr, br, bl]);
  const k = 600 / Math.max(L, W);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(L * k));
  out.height = Math.max(1, Math.round(W * k));
  const s = src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  const o = out.getContext("2d")!.createImageData(out.width, out.height);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const p = apply(h, (x + 0.5) / k, (y + 0.5) / k);
      const sx = Math.min(src.width - 1, Math.max(0, Math.round(p.x)));
      const sy = Math.min(src.height - 1, Math.max(0, Math.round(p.y)));
      const si = (sy * src.width + sx) * 4;
      const oi = (y * out.width + x) * 4;
      o.data[oi] = s.data[si];
      o.data[oi + 1] = s.data[si + 1];
      o.data[oi + 2] = s.data[si + 2];
      o.data[oi + 3] = 255;
    }
  out.getContext("2d")!.putImageData(o, 0, 0);
  return out;
}

/**
 * Mark unusable areas from a photo: take a picture of the sheet, tap its four
 * corners, and anything that doesn't look like the rest of the sheet (holes,
 * cut-outs showing the floor through them) is marked. It's a guess, so it's
 * shown first and stays editable on the map.
 */
export function SheetPhoto({
  length: L,
  width: W,
  onApply,
  onCancel,
}: {
  length: number;
  width: number;
  /** replace = drop the areas marked before */
  onApply: (zones: Zone[], photo: string, replace: boolean) => void;
  onCancel: () => void;
}) {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [flat, setFlat] = useState<{ canvas: HTMLCanvasElement; url: string; cells: Cells } | null>(null);
  const [level, setLevel] = useState(4);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);

  // straighten once all four corners are in
  useEffect(() => {
    if (!src || pts.length !== 4) return;
    const canvas = rectify(src, pts, L, W);
    const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the photo, heavy to compute during render
    setFlat({ canvas, url: canvas.toDataURL("image/jpeg", 0.8), cells: scoreCells(img, L, W) });
  }, [src, pts, L, W]);

  const zones = flat ? zonesFrom(flat.cells, level, L, W) : [];

  // the straightened photo with what's found drawn over it
  useEffect(() => {
    const c = preview.current;
    if (!c || !flat) return;
    c.width = flat.canvas.width;
    c.height = flat.canvas.height;
    const g = c.getContext("2d")!;
    g.drawImage(flat.canvas, 0, 0);
    const k = c.width / L;
    g.fillStyle = "rgba(220, 38, 38, 0.35)";
    g.strokeStyle = "rgb(220, 38, 38)";
    g.lineWidth = 2;
    for (const z of zones) {
      g.fillRect(z.x * k, z.y * k, z.w * k, z.h * k);
      g.strokeRect(z.x * k, z.y * k, z.w * k, z.h * k);
    }
  });

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try {
      setSrc(await loadPhoto(f));
      setPts([]);
      setFlat(null);
    } catch {
      setErr("Couldn't open that photo. Try a JPEG or PNG.");
    }
  }

  function tap(e: MouseEvent<HTMLCanvasElement>) {
    if (!src || pts.length >= 4) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPts([...pts, { x: ((e.clientX - r.left) / r.width) * src.width, y: ((e.clientY - r.top) / r.height) * src.height }]);
  }

  // draw the photo and the taps
  const photo = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = photo.current;
    if (!c || !src) return;
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    const r = Math.max(src.width, src.height) / 80;
    g.lineWidth = r / 3;
    g.strokeStyle = "rgb(124, 58, 237)";
    g.fillStyle = "rgba(124, 58, 237, 0.85)";
    if (pts.length > 1) {
      const o = pts.length === 4 ? orderCorners(pts) : pts;
      g.beginPath();
      o.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      if (pts.length === 4) g.closePath();
      g.stroke();
    }
    for (const p of pts) {
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
    }
  }, [src, pts]);

  return (
    <div className="card p-3 flex flex-col gap-2" style={{ background: "var(--paper)" }}>
      <div className="flex items-center justify-between">
        <span className="eyebrow" style={{ color: "var(--purple)" }}>
          From a photo
        </span>
        <button type="button" className="text-xs underline" onClick={onCancel}>
          cancel
        </button>
      </div>
      <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {!src ? (
        <>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Lay the sheet flat on something that isn&apos;t the same color as it (the floor, a dark table) and take the picture from above, the whole sheet in frame.
          </p>
          <button type="button" className="btn btn-primary text-sm self-start" onClick={() => file.current?.click()}>
            Take or choose a photo
          </button>
        </>
      ) : !flat ? (
        <>
          <p className="text-sm">
            Tap the sheet&apos;s 4 corners <span className="mono">({pts.length}/4)</span>
          </p>
          <canvas ref={photo} onClick={tap} className="w-full rounded-lg" style={{ cursor: "crosshair", maxHeight: 420, objectFit: "contain" }} />
          <div className="flex gap-3 text-xs">
            {pts.length > 0 && (
              <button type="button" className="underline" onClick={() => setPts(pts.slice(0, -1))}>
                undo corner
              </button>
            )}
            <button type="button" className="underline" onClick={() => file.current?.click()}>
              different photo
            </button>
          </div>
        </>
      ) : (
        <>
          <canvas ref={preview} className="w-full rounded-lg" style={{ maxHeight: 320, objectFit: "contain" }} />
          <label className="flex items-center gap-2 text-xs">
            <span style={{ color: "var(--muted)" }}>Marks more</span>
            <input type="range" min={2} max={8} step={0.5} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="flex-1" aria-label="How different from the sheet counts as unusable" />
            <span style={{ color: "var(--muted)" }}>Marks less</span>
          </label>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {zones.length
              ? `Found ${zones.length} area${zones.length === 1 ? "" : "s"}. A guess from the picture, so check it: you can fix any area on the map after.`
              : "Nothing stood out. Slide toward “Marks more”, or the sheet may be clean."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary text-sm" onClick={() => onApply(zones, flat.url, true)}>
              Use these
            </button>
            <button type="button" className="btn btn-ghost text-sm" onClick={() => onApply(zones, flat.url, false)}>
              Add to what&apos;s marked
            </button>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => {
                setPts([]);
                setFlat(null);
              }}
            >
              redo corners
            </button>
          </div>
        </>
      )}
      {err && (
        <p className="text-sm" style={{ color: "var(--bad)" }} role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
