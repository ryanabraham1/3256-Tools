// Rebuilds the tech binder's robot model and CAD stats from Onshape.
//   ONSHAPE_ACCESS_KEY=… ONSHAPE_SECRET_KEY=… node scripts/binder-cad.mjs <assembly URL>
// Writes CAD renders to public/binder/*.webp and part stats to lib/binder-cad.json.
// Each top-level subassembly of the robot assembly becomes one binder subsystem.
// Renders come from Onshape's own renderer, so hidden parts stay hidden and colours match the CAD.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const url = process.argv[2];
const m = /documents\/(\w{24})\/w\/(\w{24})\/e\/(\w{24})/.exec(url ?? "");
if (!m) throw new Error("Pass the Onshape assembly URL (…/documents/<did>/w/<wid>/e/<eid>)");
const [, did, wid, eid] = m;
const { ONSHAPE_ACCESS_KEY: key, ONSHAPE_SECRET_KEY: secret } = process.env;
if (!key || !secret) throw new Error("Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY");

const API = "https://cad.onshape.com/api/v10";
const headers = { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, Accept: "application/json" };
const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) throw new Error(`Onshape ${res.status} on ${path}`);
  return res.json();
};

// ── Stats ────────────────────────────────────────────────────────────────────
const asm = await get(`/assemblies/d/${did}/w/${wid}/e/${eid}`);
const defs = new Map(asm.subAssemblies.map((s) => [`${s.documentId}/${s.elementId}/${s.configuration}`, s.instances]));
const children = (i) => defs.get(`${i.documentId}/${i.elementId}/${i.configuration}`) ?? [];
const clean = (name) => name.replace(/\s*<\d+>$/, "");
const MOTOR = /^(Kraken X60|Kraken X44|NEO Vortex|NEO 550|NEO|Minion|Falcon 500)\b(?!.*(Board|Cap|Adapter|Spacer|Coupler|Kit|Gear))/;
// Parts worth calling out: vendor hardware that says something about the design.
const NOTABLE = /bearing|encoder|cancoder|pigeon|limelight|swerve|maxplanetary|planetary|thrifty|ttb-|belt|pulley|sprocket|chain|roller|wheel|flywheel/i;

const subsystems = [];
for (const top of asm.rootAssembly.instances) {
  if (top.type !== "Assembly" || top.suppressed) continue;
  const doc = await get(`/documents/${top.documentId}`);
  const stats = { parts: 0, unique: new Set(), motors: {}, custom: new Set(), notable: new Map() };
  const walk = (list) => {
    for (const i of list) {
      if (i.suppressed) continue;
      if (i.type === "Assembly") { walk(children(i)); continue; }
      const name = clean(i.name);
      stats.parts++;
      stats.unique.add(name);
      const motor = MOTOR.exec(name)?.[1];
      if (motor) stats.motors[motor] = (stats.motors[motor] ?? 0) + 1;
      // Team-made parts follow the NNNN_Name numbering.
      if (/^\d{4}_/.test(name)) stats.custom.add(name.replace(/^\d{4}_/, "").replace(/_/g, " "));
      else if (!motor && NOTABLE.test(name)) stats.notable.set(name, (stats.notable.get(name) ?? 0) + 1);
    }
  };
  walk(children(top));
  subsystems.push({
    node: top.name,
    ref: { did: top.documentId, ref: top.documentVersion ? `v/${top.documentVersion}` : `m/${top.documentMicroversion}`, eid: top.elementId },
    document: doc.name.replace(/^\d+\.\s*/, ""),
    parts: stats.parts,
    uniqueParts: stats.unique.size,
    motors: stats.motors,
    customParts: [...stats.custom].sort(),
    hardware: [...stats.notable].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, qty]) => ({ name, qty })),
  });
}

// ── Renders ──────────────────────────────────────────────────────────────────
const VIEWS = { iso: "trimetric", front: "front", side: "right", top: "top" };

async function shaded({ did, ref, eid }, view, width, height) {
  const res = await get(`/assemblies/d/${did}/${ref}/e/${eid}/shadedviews?viewMatrix=${view}&outputWidth=${width}&outputHeight=${height}&pixelSize=0&useAntiAliasing=true`);
  if (!res.images?.[0]) throw new Error(`No render for ${eid} (${view})`);
  return Buffer.from(res.images[0], "base64");
}

/** White background → transparent, stray specks (mate-connector cubes and the like) dropped, trimmed, webp. */
async function cutout(png, file) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = w * h;
  const light = (i) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  // Flood the background in from the edges so white parts inside the robot stay solid.
  const bg = new Uint8Array(px);
  const queue = new Int32Array(px);
  let head = 0, tail = 0;
  const seed = (i) => { if (!bg[i] && light(i) >= 232) { bg[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < px - w) seed(i + w);
  }
  // Anti-aliased edge pixels fade out instead of leaving a white fringe.
  for (let i = 0; i < px; i++) if (bg[i]) data[i * 4 + 3] = Math.max(0, Math.min(255, (255 - light(i)) * 11));
  // Label the remaining blobs so detached specks can be dropped.
  const comp = new Int32Array(px).fill(-1);
  const blobs = [];
  for (let s = 0; s < px; s++) {
    if (comp[s] !== -1 || data[s * 4 + 3] < 40) continue;
    const id = blobs.length, b = { id, n: 0, x0: w, y0: h, x1: 0, y1: 0 };
    head = tail = 0; queue[tail++] = s; comp[s] = id;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = (i / w) | 0;
      b.n++; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < px && comp[j] === -1 && data[j * 4 + 3] >= 40) { comp[j] = id; queue[tail++] = j; }
      }
    }
    blobs.push(b);
  }
  const main = blobs.reduce((a, b) => (b.n > a.n ? b : a));
  // Small blobs sticking out past the real geometry are view cubes, origin markers and mate
  // connectors; left in, they stretch the trim and leave the part floating in empty space.
  const real = blobs.filter((b) => b.n >= main.n * 0.05);
  const box = { x0: Math.min(...real.map((b) => b.x0)), y0: Math.min(...real.map((b) => b.y0)), x1: Math.max(...real.map((b) => b.x1)), y1: Math.max(...real.map((b) => b.y1)) };
  const outside = (b) => b.x0 < box.x0 || b.y0 < box.y0 || b.x1 > box.x1 || b.y1 > box.y1;
  const stray = new Set(blobs.filter((b) => b.n < main.n * 0.01 || (b.n < main.n * 0.05 && outside(b))).map((b) => b.id));
  for (let i = 0; i < px; i++) if (stray.has(comp[i])) data[i * 4 + 3] = 0;
  const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).webp({ quality: 84, alphaQuality: 90 }).toBuffer({ resolveWithObject: true });
  writeFileSync(`public/binder/${file}`, out.data);
  return { src: `/binder/${file}`, w: out.info.width, h: out.info.height };
}

rmSync("public/binder", { recursive: true, force: true });
mkdirSync("public/binder", { recursive: true });
const slug = (s) => s.toLowerCase().replace(/<\d+>/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const robot = await cutout(await shaded({ did, ref: `w/${wid}`, eid }, "trimetric", 2400, 1600), "robot.webp");
// Onshape takes a while per render, so each subsystem's views render in parallel.
for (const s of subsystems) {
  const views = await Promise.all(Object.entries(VIEWS).map(async ([name, matrix]) =>
    [name, await cutout(await shaded(s.ref, matrix, 1800, 1350), `${slug(s.node)}-${name}.webp`)]));
  s.views = Object.fromEntries(views);
  delete s.ref;
  console.log(`rendered ${s.document}`);
}

const out = { source: url, generated: new Date().toISOString().slice(0, 10), robot, subsystems };
writeFileSync("lib/binder-cad.json", JSON.stringify(out, null, 2) + "\n");
console.log(`lib/binder-cad.json: ${subsystems.length} subsystems`);
