"use client";

import { useState, useTransition } from "react";
import { fetchGoogleDoc, importPitItems } from "@/app/pit-actions";
import { PHASES, PHASE_LABEL, type Phase } from "@/lib/pit";
import { parseChecklist, type ImportRow } from "@/lib/pit-import";
import { ErrorText, Field } from "./fab-ui";

/** Paste, upload (.docx / .pdf / .txt / .md) or link a Google Doc → review the checks → import. */
export function PitImport({ hasItems, onDone }: { hasItems: boolean; onDone: () => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fallback, setFallback] = useState<Phase>("pre_match");
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function parse(t: string) {
    setText(t);
    const r = parseChecklist(t, fallback);
    setRows(r);
    setError(r.length ? null : "Couldn't find any checks in that. Put each check on its own line (bullets or checkboxes work best).");
  }

  async function onFile(file: File) {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".docx")) parse(await docxText(file));
      else if (name.endsWith(".pdf")) parse(await pdfText(file));
      else if (/\.(txt|md|markdown|csv)$/.test(name) || file.type.startsWith("text/")) parse(await file.text());
      else setError("Upload a .docx, .pdf, .txt or .md file. For a Google Doc: File → Download → Microsoft Word (.docx).");
    } catch (e) {
      setError(`Couldn't read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function fromLink(url: string) {
    setError(null);
    setBusy("Opening the doc…");
    const fd = new FormData();
    fd.set("url", url);
    fetchGoogleDoc(fd)
      .then((r) => (r.ok ? parse(r.data ?? "") : setError(r.error)))
      .finally(() => setBusy(null));
  }

  function save() {
    if (!rows?.length) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("rows", JSON.stringify(rows));
      if (replace) fd.set("replace", "on");
      const r = await importPitItems(fd);
      if (r.ok) onDone();
      else setError(r.error);
    });
  }

  const edit = (n: number, patch: Partial<ImportRow>) => setRows((rs) => rs && rs.map((r, i) => (i === n ? { ...r, ...patch } : r)));

  if (rows?.length)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Found <b style={{ color: "var(--ink)" }}>{rows.length}</b> checks. Fix anything that landed in the wrong list, then import.
        </p>
        <ul className="flex flex-col gap-2 max-h-[48dvh] overflow-y-auto -mx-1 px-1">
          {rows.map((r, n) => (
            <li key={n} className="rounded-lg p-2.5 flex flex-col gap-1.5" style={{ border: "1px solid var(--line)" }}>
              <div className="flex gap-2 items-start">
                <input className="input py-1.5 flex-1" style={{ minHeight: 38 }} value={r.title} onChange={(e) => edit(n, { title: e.target.value })} aria-label="Check" />
                <button type="button" className="btn btn-ghost w-10 min-h-[38px] p-0 shrink-0" onClick={() => setRows(rows.filter((_, i) => i !== n))} aria-label={`Drop ${r.title}`}>
                  ✕
                </button>
              </div>
              <div className="flex gap-2 flex-wrap items-center text-sm">
                <select className="input w-auto py-1" style={{ minHeight: 34, fontSize: 14 }} value={r.phase} onChange={(e) => edit(n, { phase: e.target.value as Phase })} aria-label="When">
                  {PHASES.map((p) => (
                    <option key={p} value={p}>
                      {PHASE_LABEL[p]}
                    </option>
                  ))}
                </select>
                <input className="input w-28 py-1" style={{ minHeight: 34, fontSize: 14 }} value={r.section} placeholder="Section" onChange={(e) => edit(n, { section: e.target.value })} aria-label="Section" />
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={r.critical} onChange={(e) => edit(n, { critical: e.target.checked })} /> Critical
                </label>
              </div>
              {r.how && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {r.how}
                </p>
              )}
            </li>
          ))}
        </ul>
        {hasItems && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the current checklist (old checks are removed, past runs keep them)
          </label>
        )}
        <ErrorText error={error} />
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setRows(null)}>
            ← Back
          </button>
          <button type="button" className="btn btn-primary flex-1" onClick={save} disabled={pending}>
            {pending ? "Importing…" : `Import ${rows.length} checks`} <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Field label="Upload a file" hint="Word (.docx), PDF, or text. Google Doc: File → Download → Microsoft Word.">
        <input
          type="file"
          accept=".docx,.pdf,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="input"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </Field>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          fromLink(String(new FormData(e.currentTarget).get("url") ?? ""));
        }}
      >
        <Field label="…or a Google Docs link" hint="The doc has to be shared as “Anyone with the link can view”.">
          <div className="flex gap-2">
            <input name="url" className="input flex-1" placeholder="https://docs.google.com/document/d/…" inputMode="url" autoCapitalize="none" />
            <button type="submit" className="btn btn-ghost shrink-0" disabled={!!busy}>
              Open
            </button>
          </div>
        </Field>
      </form>
      <Field label="…or paste it" hint="One check per line. Headings like “Pre-match” or “Electrical:” set the list and section; add (critical) or ! to mark a must-do.">
        <textarea className="input mono text-sm" style={{ minHeight: 140 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Pre-match\n- Battery strapped — tug-test it (critical)\n- Bumpers right colour\n\nPost-match\n- Walk-around for damage"} />
      </Field>
      <Field label="Checks with no heading go to">
        <select className="input" value={fallback} onChange={(e) => setFallback(e.target.value as Phase)}>
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {PHASE_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
      {busy && <p className="text-sm" style={{ color: "var(--muted)" }}>{busy}</p>}
      <ErrorText error={error} />
      <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => parse(text)}>
        Find checks <span aria-hidden>→</span>
      </button>
    </div>
  );
}

// ── File readers (all in the browser; nothing is uploaded) ──

/** A .docx is a zip; read word/document.xml and turn paragraphs into lines (headings → "#", list items → "-"). */
async function docxText(file: File): Promise<string> {
  const xml = await unzipEntry(new Uint8Array(await file.arrayBuffer()), "word/document.xml");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const lines: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    const text = Array.from(p.getElementsByTagNameNS(W, "t"))
      .map((t) => t.textContent ?? "")
      .join("")
      .trim();
    if (!text) {
      lines.push("");
      continue;
    }
    const style = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? "";
    const num = p.getElementsByTagNameNS(W, "numPr")[0];
    const level = Number(num?.getElementsByTagNameNS(W, "ilvl")[0]?.getAttributeNS(W, "val") ?? 0);
    if (/^(heading|title)/i.test(style)) lines.push(`# ${text}`);
    else if (num) lines.push(`${"  ".repeat(level)}- ${text}`);
    else lines.push(text);
  }
  return lines.join("\n");
}

async function unzipEntry(zip: Uint8Array, want: string): Promise<string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory → central directory → local header.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("not a Word file");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    if (name === want) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = zip.subarray(start, start + size);
      if (method === 0) return new TextDecoder().decode(data);
      if (method !== 8) throw new Error("unsupported compression");
      const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }
    at += 46 + nameLen + extra + comment;
  }
  throw new Error("no document inside");
}

/** PDF text, one line per row of text on the page. */
async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines: { x: number; text: string }[] = [];
    let y: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const iy = item.transform[5];
      const last = lines[lines.length - 1];
      if (!last || y === null || Math.abs(iy - y) > 2) lines.push({ x: item.transform[4], text: item.str });
      else last.text += item.str;
      y = item.hasEOL ? null : iy;
    }
    // Keep indentation (relative to the page's left edge) so sub-points stay under their check.
    const left = Math.min(...lines.filter((l) => l.text.trim()).map((l) => l.x));
    for (const l of lines) out.push(" ".repeat(Math.max(0, Math.round((l.x - left) / 18)) * 2) + l.text);
    out.push("");
  }
  return out.join("\n");
}
