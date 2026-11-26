import "server-only";

/**
 * Finding where to buy a COTS part from what Onshape knows about it (vendor
 * + a part number or description). Most FRC vendors run Shopify stores, whose
 * public catalog (/products.json) lists every variant's SKU with its price,
 * so a part number resolves to the exact product page. Others get a direct
 * (McMaster) or search (REV, goBILDA, VEX) link.
 */

export interface VendorHit {
  url: string;
  /** per pack (or each), dollars; null when the store doesn't say */
  price: number | null;
  /** units per pack ("(5-Pack)" in the product name) */
  pack: number | null;
  vendor: string;
  title: string;
  sku?: string;
}

interface Store {
  host: string;
  vendor: string;
  matches: (vendor: string, pn: string) => boolean;
}

const WCP: Store = { host: "wcproducts.com", vendor: "West Coast Products", matches: (v, pn) => /^WCP-/i.test(pn) || /west\s*coast|\bwcp\b/i.test(v) };
const STORES: Store[] = [
  WCP,
  { host: "andymark.com", vendor: "AndyMark", matches: (v, pn) => /^am-\d/i.test(pn) || /andy\s*mark/i.test(v) },
  { host: "www.swervedrivespecialties.com", vendor: "Swerve Drive Specialties", matches: (v, pn) => /^SDS/i.test(pn) || /swerve drive spec|\bsds\b/i.test(v) },
  { host: "store.ctr-electronics.com", vendor: "CTR Electronics", matches: (v) => /\bctr\b|ctre|cross the road/i.test(v) },
  { host: "www.thethriftybot.com", vendor: "ThriftyBot", matches: (v, pn) => /^TTB/i.test(pn) || /thrifty/i.test(v) },
];

interface Catalog {
  at: number;
  bySku: Map<string, VendorHit>;
  byTitle: Map<string, VendorHit[]>;
  bySpec: Map<string, VendorHit[]>;
}
const catalogs = new Map<string, Promise<Catalog>>();
const TTL = 6 * 3600_000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const inch = String.raw`(?:\d+[- ]+)?\d+\/\d+|\d*\.\d+|\d+`;
function inchValue(text: string): number {
  const fraction = /^(?:(\d+)[- ]+)?(\d+)\/(\d+)$/.exec(text);
  return fraction ? Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]) : Number(text);
}

const screwHead = /\b(?:socket head cap screw|socket head screw|shcs|(?:socket )?button head cap screw|bhcs)\b/i;
const screwSize = new RegExp(String.raw`(#?\d+(?:\/\d+)?)"?\s*-\s*(\d+)\s*[x×]\s*(${inch})(?:"|\s*in\b)?(?:\s*l\b)?`, "i");
const bearingSize = new RegExp(String.raw`(${inch})\s*(?:"|in\b)\s*(id|od|wd)\b`, "gi");
const mirrorBase = (name: string) => name.replace(/[\s-]*mirrored$/i, "").trim();

function specOf(title: string, strict = true): string | null {
  const text = mirrorBase(title).toLowerCase().replace(/[“”″]/g, '"').replace(/[–−]/g, "-");
  const head = screwHead.exec(text);
  const size = screwSize.exec(text);
  if (head && size) {
    const rest = text.replace(head[0], "").replace(size[0], "")
      .replace(/\((?:steel|alloy steel|stainless steel|aluminum|black oxide|\d+[- ]*pack)(?:,\s*black oxide)?\)/g, "").trim();
    if (strict && rest) return null;
    const length = inchValue(size[3]);
    if (!Number.isFinite(length) || length <= 0) return null;
    return `screw:${/button|bhcs/.test(head[0]) ? "button" : "socket"}:${size[1].replace("#", "")}-${size[2]}:${length}`;
  }
  if (/\bbearings?\b/.test(text)) {
    const dims = new Map(Array.from(text.matchAll(bearingSize), (m) => [m[2], inchValue(m[1])]));
    const type = norm(text.replace(bearingSize, "").replace(/\s[x×](?=\s|$)/g, " ").replace(/\(\d+[- ]*pack\)/g, ""));
    if (dims.size === 3 && type && [...dims.values()].every((n) => Number.isFinite(n) && n > 0))
      return `bearing:${type}:${dims.get("id")}:${dims.get("od")}:${dims.get("wd")}`;
  }
  return null;
}

// The WCP catalog identifies these Onshape template screws as black-oxide steel.
const WCP_STEEL_SCREW_SPECS = new Map([
  ["WCP-0268", "screw:socket:10-32:1.5"],
  ["WCP-0270", "screw:socket:10-32:2.5"],
  ["WCP-2243", "screw:socket:10-32:1.25"],
  ["WCP-2244", "screw:socket:10-32:1.375"],
  ["WCP-2249", "screw:socket:8-32:1"],
]);

export function cotsMaterial(part: { name: string; part_number: string }, material: string): string {
  if (!/^stainless steel$/i.test(material.trim())) return material;
  const verifiedSpec = WCP_STEEL_SCREW_SPECS.get(part.part_number.trim().toUpperCase());
  return verifiedSpec && verifiedSpec === specOf(part.name) ? "Steel" : material;
}

function materialOf(text: string): string | undefined {
  return /\bstainless\b/i.test(text) ? "stainless"
    : /\balumin(?:um|ium)\b/i.test(text) ? "aluminum"
    : /\b(?:steel|black oxide)\b/i.test(text) ? "steel" : undefined;
}

function indexHit(index: Map<string, VendorHit[]>, key: string, hit: VendorHit) {
  const hits = index.get(key);
  if (hits) hits.push(hit);
  else index.set(key, [hit]);
}

function uniqueHit(hits: VendorHit[] | undefined, material: string | undefined): VendorHit | null {
  const matches = hits?.filter((hit) => {
    const candidate = materialOf(hit.title);
    return !material || !candidate || candidate === material;
  });
  return matches?.length === 1 ? matches[0] : null;
}
const packOf = (...texts: (string | undefined)[]) => {
  for (const t of texts) {
    const m = /\(?(\d+)[\s-]*(?:pack|pk|pcs|pieces)\)?/i.exec(t ?? "");
    if (m && Number(m[1]) > 1) return Number(m[1]);
  }
  return null;
};

async function loadCatalog(s: Store): Promise<Catalog> {
  const bySku = new Map<string, VendorHit>();
  const byTitle = new Map<string, VendorHit[]>();
  const bySpec = new Map<string, VendorHit[]>();
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`https://${s.host}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "FRC3256-Tools/1.0 (team build tracker)" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${s.vendor} catalog returned HTTP ${res.status}`);
    const { products } = (await res.json()) as {
      products?: { handle: string; title: string; body_html?: string; variants?: { id: number; sku?: string; price?: string; title?: string }[] }[];
    };
    if (!products?.length) break;
    for (const p of products) {
      for (const v of p.variants ?? []) {
        const one = (p.variants?.length ?? 0) <= 1;
        const title = one || !v.title || v.title === "Default Title" ? p.title : `${p.title} — ${v.title}`;
        const spec = specOf(title);
        // WCP lists SKUs and prices on reference pages and sells these parts
        // through the associated product configurators.
        const family = s === WCP && /this page is for reference only/i.test(p.body_html ?? "")
          ? (spec?.startsWith("screw:socket:") ? "socket-head-bolts"
            : spec?.startsWith("screw:button:") ? "bolts"
            : spec?.startsWith("bearing:needle bearing:") ? "specialty-bearings" : null)
          : null;
        const hit: VendorHit = {
          url: `https://${s.host}/products/${family ?? p.handle}${one || family ? "" : `?variant=${v.id}`}`,
          price: v.price ? Number(v.price) : null,
          pack: packOf(p.title, v.title),
          vendor: s.vendor,
          title,
          sku: v.sku?.trim() || undefined,
        };
        if (hit.sku) bySku.set(hit.sku.toUpperCase(), hit);
        indexHit(byTitle, norm(hit.title), hit);
        if (spec) indexHit(bySpec, spec, hit);
      }
    }
    if (products.length < 250) break;
  }
  return { at: Date.now(), bySku, byTitle, bySpec };
}

function catalog(s: Store): Promise<Catalog> {
  const cur = catalogs.get(s.host);
  if (cur) {
    // refresh in the background-ish: a stale one is replaced on the next call
    void cur.then((c) => {
      if (Date.now() - c.at > TTL && catalogs.get(s.host) === cur) catalogs.delete(s.host);
    }, () => {});
    return cur;
  }
  const p = loadCatalog(s).catch((e) => {
    catalogs.delete(s.host);
    throw e;
  });
  catalogs.set(s.host, p);
  return p;
}

const MCMASTER = /^\d{4,5}[A-Z]\d{1,5}$/i;

/** Where to buy one part; null when nothing points anywhere. */
export async function findVendorLink(part: { name: string; vendor: string; part_number: string; material_text?: string }): Promise<VendorHit | null> {
  const pn = part.part_number.trim();
  const usable = pn && !/^(n\/?a|none|-)$/i.test(pn) && pn.length <= 40 && !/\s{2,}|\(/.test(pn);
  const vendor = part.vendor.trim();

  if (usable && (MCMASTER.test(pn) || /mcmaster/i.test(vendor))) {
    return { url: `https://www.mcmaster.com/${encodeURIComponent(pn)}/`, price: null, pack: null, vendor: "McMaster-Carr", title: part.name };
  }
  const store = STORES.find((s) => s.matches(vendor, usable ? pn : ""));
  if (store) {
    const c = await catalog(store);
    const spec = specOf(part.name);
    const material = materialOf(part.material_text ?? "") ?? materialOf(part.name);
    if (usable) {
      // exact SKU, then without a length / option suffix (WCP-1743-001 → WCP-1743)
      let key = pn.toUpperCase();
      for (let i = 0; i < 3; i++) {
        const hit = c.bySku.get(key);
        if (hit) {
          const hitSpec = specOf(hit.title, false);
          const hitMaterial = materialOf(hit.title);
          if (spec && ((hitSpec && spec !== hitSpec) || (material && hitMaterial && material !== hitMaterial))) return null;
          // A family SKU can describe a different variant. Require a matching
          // specification before trusting a shortened hardware SKU.
          if (i > 0 && spec && hitSpec !== spec) break;
          return hit;
        }
        const cut = key.replace(/-[^-]+$/, "");
        if (cut === key) break;
        key = cut;
      }
    }
    const named = c.byTitle.get(norm(mirrorBase(part.name)));
    const byName = uniqueHit(spec ? named?.filter((hit) => specOf(hit.title) === spec) : named, spec ? material : undefined);
    if (byName) return byName;
    const bySpec = spec && uniqueHit(c.bySpec.get(spec), material);
    if (bySpec) return bySpec;
    if (usable) return { url: `https://${store.host}/search?q=${encodeURIComponent(pn)}`, price: null, pack: null, vendor: store.vendor, title: part.name };
    return null;
  }
  if (!usable) return null;
  if (/^REV-/i.test(pn) || /\brev\b/i.test(vendor))
    return { url: `https://www.revrobotics.com/search.php?search_query=${encodeURIComponent(pn)}`, price: null, pack: null, vendor: "REV Robotics", title: part.name };
  if (/gobilda/i.test(vendor))
    return { url: `https://www.gobilda.com/search-results-page/?q=${encodeURIComponent(pn)}`, price: null, pack: null, vendor: "goBILDA", title: part.name };
  if (/\bvex\b/i.test(vendor))
    return { url: `https://www.vexrobotics.com/search?q=${encodeURIComponent(pn)}`, price: null, pack: null, vendor: "VEX Robotics", title: part.name };
  return null;
}
