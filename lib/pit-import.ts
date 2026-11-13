/**
 * Turn a checklist written in a doc (pasted text, .docx, .pdf, Google Doc) into
 * check items. Headings become the phase or section; bullet / checkbox /
 * numbered lines become checks. Client-safe.
 */
import type { Phase } from "./pit";

export interface ImportRow {
  phase: Phase;
  section: string;
  title: string;
  how: string;
  critical: boolean;
}

const PHASE_WORDS: [RegExp, Phase][] = [
  [/\b(pre[\s-]?match|before (the |each |every )?match|queue|queuing|on[\s-]?deck)\b/i, "pre_match"],
  [/\b(post[\s-]?match|after (the |each |every )?match|between matches|return(ing)? from (the )?field)\b/i, "post_match"],
  [/\b(start of (the )?day|morning|load[\s-]?in|opening|daily|setup|set[\s-]?up|arrival)\b/i, "morning"],
  [/\b(end of (the )?day|evening|night|pack[\s-]?(up|out)|load[\s-]?out|closing|leaving)\b/i, "end_of_day"],
];

export function phaseOf(text: string): Phase | null {
  for (const [re, p] of PHASE_WORDS) if (re.test(text)) return p;
  return null;
}

// "- ", "* ", "• ", "☐ ", "[ ] ", "1. ", "a) " …
const BULLET = /^\s*(?:[•◦▪▫‣⁃○●■□☐☑✓✔❑❏➢➤]+\s*|[-*>]+\s+|\[\s?[xX ]?\s?\]\s*|\(?\d{1,3}[.)]\s+|\(?[a-zA-Z][.)]\s+)/;
const CRITICAL = /(\(critical\)|\[critical\]|\bcritical\b:?|‼|!!|\*\*!|^!\s*|!\s*$)/i;

export function parseChecklist(text: string, fallback: Phase = "pre_match"): ImportRow[] {
  const rows: ImportRow[] = [];
  let phase: Phase = fallback;
  let section = "";
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/ /g, " ").replace(/\s+$/, ""));
  const anyBullets = lines.some((l) => BULLET.test(l));

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = raw.trim();
    if (!line) continue;
    const md = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = BULLET.test(raw);
    // A heading: markdown #, a line ending in ":", ALL CAPS, or (in a bulleted doc) a plain line followed by bullets.
    const nextBullet = lines.slice(n + 1).find((l) => l.trim());
    const heading =
      !!md ||
      (!bullet && /:$/.test(line) && line.length <= 80) ||
      (!bullet && line.length <= 60 && line === line.toUpperCase() && /[A-Z]/.test(line)) ||
      (anyBullets && !bullet && line.length <= 60 && !!nextBullet && BULLET.test(nextBullet));
    if (heading) {
      const h = (md ? md[1] : line).replace(/[:*_#]+$/g, "").replace(/^[*_]+/, "").trim();
      const p = phaseOf(h);
      if (p) {
        phase = p;
        section = "";
      } else section = titleCase(h);
      continue;
    }
    // In a bulleted doc, stray paragraphs are notes, not checks.
    if (anyBullets && !bullet) {
      const last = rows[rows.length - 1];
      if (last && line.length <= 300) last.how = [last.how, line].filter(Boolean).join(" ");
      continue;
    }
    let body = line.replace(BULLET, "").trim();
    // Indented sub-bullets explain the check above them.
    const indent = raw.length - raw.trimStart().length;
    const last = rows[rows.length - 1];
    if (bullet && indent >= 2 && last && rows.length) {
      last.how = [last.how, body].filter(Boolean).join("; ");
      continue;
    }
    // ALL-CAPS checks, and everything under an "Essential" heading, are must-dos.
    const letters = body.replace(/[^a-zA-Z]/g, "");
    const shouting =
      (letters.length >= 8 && letters === letters.toUpperCase()) || /^[A-Z0-9'’&/]{2,}(\s+[A-Z0-9'’&/]{2,})+\s/.test(body);
    // The doc's own title ("PIT CHECKLIST") isn't a check.
    if (/\bchecklist\b/i.test(body) && letters === letters.toUpperCase()) continue;
    const critical = CRITICAL.test(body) || shouting || /\b(essential|critical|must)\b/i.test(section);
    body = body.replace(/\s*(\(critical\)|\[critical\])\s*/gi, " ").replace(/^critical:?\s*/i, "").replace(/^!+\s*|\s*!+$/g, "").trim();
    // "Battery strapped — tug-test it" → title + how
    const split = /^(.{3,120}?)\s+[—–-]\s+(.+)$/.exec(body);
    const title = (split ? split[1] : body).replace(/[*_]{2,}/g, "").trim();
    if (!title || title.length > 200) continue;
    rows.push({ phase, section, title, how: split ? split[2].trim() : "", critical });
  }
  return rows;
}

function titleCase(s: string): string {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}

export interface PdfText {
  str: string;
  x: number;
  y: number;
  eol: boolean;
}

/**
 * One page of PDF text runs (in content order) → lines for parseChecklist.
 * PDFs drawn from Docs have no bullet characters (checkboxes are graphics), so
 * structure comes from layout: a line with indented lines under it is a
 * heading, the indented lines are checks, and a line closer to the one above
 * than the usual check spacing is the same check wrapping.
 */
export function pdfPageLines(runs: PdfText[]): string[] {
  const lines: { x: number; y: number; text: string }[] = [];
  let open = false;
  for (const r of runs) {
    const last = lines[lines.length - 1];
    if (r.str) {
      if (open && last && Math.abs(r.y - last.y) <= 2) last.text += r.str;
      else lines.push({ x: r.x, y: r.y, text: r.str });
      open = true;
    }
    if (r.eol) open = false;
  }
  const real = lines.filter((l) => l.text.trim());
  const same = (a: { x: number }, b: { x: number }) => Math.abs(a.x - b.x) < 3;
  // The usual spacing between checks: the most common gap between lines at the same indent.
  const gaps = new Map<number, number>();
  real.forEach((l, n) => {
    const p = real[n - 1];
    if (p && same(p, l) && p.y > l.y) gaps.set(Math.round(p.y - l.y), (gaps.get(Math.round(p.y - l.y)) ?? 0) + 1);
  });
  const step = [...gaps.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;

  const out: { x: number; y: number; text: string; heading: boolean }[] = [];
  real.forEach((l, n) => {
    const next = real[n + 1];
    const heading = !!next && next.y < l.y && next.x > l.x + 10;
    const prev = out[out.length - 1];
    if (prev && !prev.heading && !heading && same(prev, l) && prev.y > l.y && prev.y - l.y < step * 0.9) {
      prev.text = `${prev.text.trimEnd()} ${l.text.trim()}`;
      prev.y = l.y;
    } else out.push({ ...l, heading });
  });
  let indent = Infinity;
  return out.map((l) => {
    if (l.heading) {
      indent = l.x + 10;
      return `# ${l.text.trim()}`;
    }
    return l.x >= indent ? `- ${l.text.trim()}` : l.text.trim();
  });
}
