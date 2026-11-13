"use client";

import { useEffect, useRef, useState } from "react";
import { calloutLine, featuresOf, motorCount, type Feature, type Render, type Subsystem, type View } from "@/lib/binder";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Hero: the robot render with a leader line from each subsystem to its callout. */
export function BinderHero({ subsystems, render, title, eyebrow, totals }: {
  subsystems: Subsystem[];
  render: Render;
  title: string;
  eyebrow: string;
  totals: { parts: number; motors: number; custom: number };
}) {
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const callouts = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Record<string, { x1: number; y1: number; x2: number; y2: number }>>({});
  const [hover, setHover] = useState<string | null>(null);
  // Callouts sit on the side of the robot their subsystem is on, top to bottom.
  const byY = (list: Subsystem[]) => [...list].sort((a, b) => a.anchor[1] - b.anchor[1]);
  const left = byY(subsystems.filter((s) => s.anchor[0] < 50));
  const right = byY(subsystems.filter((s) => s.anchor[0] >= 50));

  useEffect(() => {
    const measure = () => {
      const st = stage.current?.getBoundingClientRect();
      const im = img.current?.getBoundingClientRect();
      if (!st || !im || !im.width) return;
      const next: typeof lines = {};
      for (const s of subsystems) {
        const r = callouts.current.get(s.id)?.getBoundingClientRect();
        if (!r || !r.width) continue;
        const onLeft = s.anchor[0] < 50;
        next[s.id] = {
          x1: (onLeft ? r.right + 14 : r.left - 14) - st.left,
          y1: r.top - st.top + 8,
          x2: im.left - st.left + (s.anchor[0] / 100) * im.width,
          y2: im.top - st.top + (s.anchor[1] / 100) * im.height,
        };
      }
      setLines(next);
    };
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    img.current?.addEventListener("load", measure);
    measure();
    return () => ro.disconnect();
  }, [subsystems]);

  const callout = (s: Subsystem, side: "left" | "right") => (
    <a
      key={s.id}
      href={`#${s.id}`}
      ref={(el) => { if (el) callouts.current.set(s.id, el); else callouts.current.delete(s.id); }}
      className={`bh-callout is-${side} ${hover === s.id ? "is-hot" : ""}`}
      onMouseEnter={() => setHover(s.id)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(s.id)}
      onBlur={() => setHover(null)}
    >
      <span>{pad2(s.index)} · {s.name}</span>
      <p>{calloutLine(s)}</p>
    </a>
  );

  return (
    <section className="bh" id="robot">
      <div className="bh-title">
        <p className="b-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className="bh-stage" ref={stage}>
        <div className="bh-col">{left.map((s) => callout(s, "left"))}</div>
        <figure className="bh-figure">
          {render && (
            // eslint-disable-next-line @next/next/no-img-element -- pre-rendered webp, already sized
            <img ref={img} src={render.src} width={render.w} height={render.h} alt="Full robot CAD render" fetchPriority="high" />
          )}
        </figure>
        <div className="bh-col">{right.map((s) => callout(s, "right"))}</div>
        <svg className="bh-lines" aria-hidden>
          {subsystems.map((s) => {
            const l = lines[s.id];
            return l ? (
              <g key={s.id} className={hover === s.id ? "is-hot" : ""}>
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
                <circle cx={l.x2} cy={l.y2} r="4.5" />
              </g>
            ) : null;
          })}
        </svg>
      </div>
      <dl className="bh-stats">
        <div><dt>Parts</dt><dd>{totals.parts}</dd></div>
        <div><dt>Motors</dt><dd>{totals.motors}</dd></div>
        <div><dt>Team-designed parts</dt><dd>{totals.custom}</dd></div>
        <div><dt>Subsystems</dt><dd>{subsystems.length}</dd></div>
      </dl>
    </section>
  );
}

export function FeatureList({ features }: { features: Feature[] }) {
  return (
    <ul className="bs-features">
      {features.map((f) => (
        <li key={f.text}>
          {f.text}
          {f.sub?.length ? <ul>{f.sub.map((x) => <li key={x}>{x}</li>)}</ul> : null}
        </li>
      ))}
    </ul>
  );
}

const VIEW_LABEL: Record<View, string> = { iso: "Iso", front: "Front", side: "Side", top: "Top" };

/** One subsystem page: the CAD figure on the left, the write-up on the right. */
export function BinderSubsystem({ s }: { s: Subsystem }) {
  const views = (Object.keys(VIEW_LABEL) as View[]).filter((v) => s.views[v]);
  const [view, setView] = useState<View>(views[0] ?? "iso");
  const render = s.views[view];
  const features = featuresOf(s);
  return (
    <section className="bs" id={s.id}>
      <div className="bs-figure-col">
        <figure className="bs-figure">
          <figcaption>
            <code>Fig. {pad2(s.index)}</code>
            <span>{s.name} · {VIEW_LABEL[view]}</span>
          </figcaption>
          <div className="bs-figure-img">
            {render && (
              // eslint-disable-next-line @next/next/no-img-element -- pre-rendered webp, already sized
              <img key={render.src} src={render.src} width={render.w} height={render.h} alt={`${s.name} CAD, ${VIEW_LABEL[view].toLowerCase()} view`} loading="lazy" />
            )}
          </div>
        </figure>
        {views.length > 1 && (
          <div className="bs-views" role="tablist" aria-label={`${s.name} view`}>
            {views.map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>{VIEW_LABEL[v]}</button>
            ))}
          </div>
        )}
      </div>

      <div className="bs-text">
        <p className="b-eyebrow">Mechanical · {pad2(s.index)}</p>
        <h2>{s.name}</h2>
        <p className="bs-lede">
          {s.tagline ?? (motorCount(s) ? `${s.parts} parts, ${motorCount(s)} ${motorCount(s) === 1 ? "motor" : "motors"}.` : `${s.parts} parts.`)}
        </p>
        <dl className="bs-cells">
          <div><dt>Parts</dt><dd>{s.parts}</dd></div>
          <div><dt>Unique</dt><dd>{s.uniqueParts}</dd></div>
          <div><dt>Motors</dt><dd>{motorCount(s)}</dd></div>
          <div><dt>Team-made</dt><dd>{s.customParts.length}</dd></div>
        </dl>
        {features.length > 0 && (
          <>
            <h3 className="b-eyebrow bs-features-head">Features</h3>
            <FeatureList features={features} />
          </>
        )}
        <p className="bs-source">CAD: {s.document}</p>
      </div>
    </section>
  );
}
