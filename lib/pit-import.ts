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
const CRITICAL = /(\(critical\)|\[critical\]|\bcritical\b:?|\bmust\b|‼|!!|\*\*!|^!\s*|!\s*$)/i;

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
    const critical = CRITICAL.test(body);
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
