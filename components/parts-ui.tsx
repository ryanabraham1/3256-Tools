"use client";

import { svgPath, type Loop } from "@/lib/geom";
import { initials, personHue, type FabPart } from "@/lib/parts";
import { sheetFabability } from "@/lib/fabable";
import { LEVEL_LABEL, LEVEL_TONE, type Level } from "@/lib/dfm";

export function PersonChip({ name, size = 26, title }: { name: string; size?: number; title?: string }) {
  const h = personHue(name);
  return (
    <span
      className="inline-flex items-center justify-center rounded-full mono font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${h} 70% 90%)`, color: `hsl(${h} 55% 28%)`, border: `1px solid hsl(${h} 50% 78%)` }}
      title={title ?? name}
      aria-label={title ?? name}
    >
      {initials(name)}
    </span>
  );
}

export function Assignees({ names, max = 3 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  return (
    <span className="inline-flex -space-x-1.5">
      {names.slice(0, max).map((n) => (
        <PersonChip key={n} name={n} size={24} />
      ))}
      {names.length > max && (
        <span className="chip" style={{ marginLeft: 4 }}>
          +{names.length - max}
        </span>
      )}
    </span>
  );
}

/** A plate's outline, drawn to fit its box. */
export function Outline({ shape, className = "", stroke = "var(--purple)" }: { shape: { loops: Loop[]; width: number; height: number }; className?: string; stroke?: string }) {
  if (!shape.loops.length) return null;
  const { width: w, height: h } = shape;
  const pad = Math.max(w, h) * 0.04;
  return (
    <svg viewBox={`${-pad} ${-h - pad} ${w + 2 * pad} ${h + 2 * pad}`} className={className} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g transform="scale(1,-1)">
        <path d={svgPath(shape.loops)} fill="var(--purple-soft)" fillRule="evenodd" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

export function DfmPill({ level, unchecked = 0, best, compact }: { level: Level; unchecked?: number; best?: string | null; compact?: boolean }) {
  const tone = LEVEL_TONE[level];
  const label = level === "info" && unchecked ? "Partly checked" : LEVEL_LABEL[level];
  return (
    <span className={`pill pill-${tone}`} title={`${label}${best ? ` · best: ${best}` : ""}`}>
      {compact ? (level === "fail" ? "✕ Can't make" : level === "warn" ? "! Check" : "✓") : label}
    </span>
  );
}

export function IssueList({ issues }: { issues: { level: string; text: string }[] }) {
  if (!issues.length) return null;
  const color = (l: string) => (l === "fail" ? "var(--bad)" : l === "warn" ? "var(--warn)" : l === "ok" ? "var(--good)" : "var(--muted)");
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {issues.map((i, k) => (
        <li key={k} className="flex gap-2">
          <span className="mono font-bold shrink-0 w-3 text-center" style={{ color: color(i.level) }} aria-hidden>
            {i.level === "fail" ? "✕" : i.level === "warn" ? "!" : "·"}
          </span>
          <span style={{ color: i.level === "info" ? "var(--muted)" : undefined }}>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Whether we can fabricate a sheet part, worked out from its material and thickness. */
export function FabablePill({ part }: { part: Pick<FabPart, "material_text" | "stock_dims" | "size_t_mm"> }) {
  const f = sheetFabability(part);
  const tone = f.fabable === true ? "good" : f.fabable === false ? "bad" : "muted";
  return (
    <span className={`pill pill-${tone}`} title={f.reason}>
      {f.fabable === true ? "✓ " : f.fabable === false ? "✕ " : ""}
      {f.label}
    </span>
  );
}

