"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { plotSeries } from "@/lib/robot-logs/core/plot";
import {
  analyze,
  currentBreakdown,
  valueAt,
  type Analysis,
  type Channel,
  type Finding,
  type PowerMapping,
  type Recording,
} from "@/lib/robot-logs/core/analysis";
import { ConnectMayhem } from "./devices";

interface CloudLog {
  sha256: string;
  name: string;
  size: number;
  created_at: string;
  device?: { name: string } | null;
}
interface Summary {
  errors: number;
  warnings: number;
  minVoltage?: number;
  duration: number;
}
type Tab = "health" | "power" | "signals" | "field";

const palette = ["var(--purple)", "#158a83", "#d48c30", "#cc5680"];
const numeric = ["double", "float", "int64", "number"];
const SUMMARY_KEY = "robot-logs.summaries.v1";
const FIELD = { width: 16.541, height: 8.069 };

async function requestJSON(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function readSummaries(): Record<string, Summary> {
  try {
    return JSON.parse(localStorage.getItem(SUMMARY_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveSummary(hash: string, summary: Summary) {
  try {
    const all = readSummaries();
    all[hash] = summary;
    localStorage.setItem(SUMMARY_KEY, JSON.stringify(all));
  } catch {}
}
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fixed = (n: number | undefined, digits = 2) => (n === undefined ? "—" : n.toFixed(digits));
function dayLabel(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/* ---------- Charts ---------- */
const VW = 1000,
  L = 46,
  R = 12,
  T = 10,
  B = 24;
function Chart({
  channel,
  overlay,
  duration,
  time,
  seek,
  findings = [],
  threshold,
  color = "var(--purple)",
  height = 200,
  label,
}: {
  channel: Channel;
  overlay?: Channel;
  duration: number;
  time: number;
  seek: (t: number) => void;
  findings?: Finding[];
  threshold?: { value: number; label: string };
  color?: string;
  height?: number;
  label: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => plotSeries(channel), [channel]);
  const overlaySeries = useMemo(() => plotSeries(overlay), [overlay]);
  const span = Math.max(duration, 0.001);
  const x = (t: number) => L + (t / span) * (VW - L - R);
  const range = (s: typeof series, withThreshold: boolean) => {
    let min = s.min,
      max = s.max;
    if (withThreshold && threshold) {
      min = Math.min(min, threshold.value);
      max = Math.max(max, threshold.value);
    }
    if (max - min < 1e-9) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  };
  const main = range(series, true);
  const y = (v: number, r = main) => T + (1 - (v - r.min) / (r.max - r.min)) * (height - T - B);
  const path = (s: typeof series, r: typeof main) =>
    s.samples.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(1)},${y(Number(p.value), r).toFixed(1)}`).join("");
  const timeAt = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return 0;
    const px = ((clientX - box.left) / box.width) * VW;
    return Math.max(0, Math.min(span, ((px - L) / (VW - L - R)) * span));
  };
  const shown = hover ?? time;
  const value = valueAt(channel, shown);
  if (!series.samples.length)
    return (
      <div className="rl-chart rl-chart-empty">
        <strong style={{ color }}>{label}</strong>
        <span>
          {channel.samples.length ? `Value now: ${String(valueAt(channel, time) ?? "—")}` : "No decoded samples for this signal."}
        </span>
      </div>
    );
  const ticks = [main.min, (main.min + main.max) / 2, main.max];
  return (
    <div className="rl-chart">
      <div className="rl-chart-head">
        <strong style={{ color }}>{label}</strong>
        <code>
          {typeof value === "number" ? value.toFixed(2) : String(value ?? "—")}
          <small> at {shown.toFixed(2)} s</small>
        </code>
        {overlay && (
          <span className="rl-chart-key">
            <i /> {overlay.name}: {String(valueAt(overlay, shown) ?? "—")}
          </span>
        )}
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${VW} ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        role="img"
        aria-label={`${label} over time`}
        onPointerMove={(e) => setHover(timeAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => seek(timeAt(e.clientX))}
      >
        {findings.map((f) => (
          <rect
            key={f.id}
            className={`rl-span is-${f.severity}`}
            x={x(f.start)}
            y={T}
            width={Math.max(2, x(f.end) - x(f.start))}
            height={height - T - B}
          />
        ))}
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="rl-grid" x1={L} x2={VW - R} y1={y(t)} y2={y(t)} />
            <text className="rl-tick" x={L - 6} y={y(t) + 4} textAnchor="end">
              {Math.abs(t) >= 100 ? t.toFixed(0) : t.toFixed(1)}
            </text>
          </g>
        ))}
        {threshold && (
          <g>
            <line className="rl-threshold" x1={L} x2={VW - R} y1={y(threshold.value)} y2={y(threshold.value)} />
            <text className="rl-tick is-bad" x={VW - R - 4} y={y(threshold.value) - 5} textAnchor="end">
              {threshold.label}
            </text>
          </g>
        )}
        {overlay && overlaySeries.samples.length > 0 && (
          <path className="rl-overlay" d={path(overlaySeries, range(overlaySeries, false))} vectorEffect="non-scaling-stroke" />
        )}
        <path d={path(series, main)} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
        <line className="rl-cursor" x1={x(time)} x2={x(time)} y1={T} y2={height - B} vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line className="rl-hover" x1={x(hover)} x2={x(hover)} y1={T} y2={height - B} vectorEffect="non-scaling-stroke" />
        )}
        <text className="rl-tick" x={L} y={height - 6}>
          0 s
        </text>
        <text className="rl-tick" x={VW - R} y={height - 6} textAnchor="end">
          {duration.toFixed(1)} s
        </text>
      </svg>
    </div>
  );
}

function Timeline({
  findings,
  duration,
  time,
  seek,
}: {
  findings: Finding[];
  duration: number;
  time: number;
  seek: (t: number, f?: Finding) => void;
}) {
  const span = Math.max(duration, 0.001);
  const pct = (t: number) => `${(t / span) * 100}%`;
  return (
    <div
      className="rl-timeline"
      role="slider"
      tabIndex={0}
      aria-label="Playback time"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Number(time.toFixed(2))}
      onPointerDown={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        seek(((e.clientX - box.left) / box.width) * span);
      }}
    >
      <span className="rl-timeline-fill" style={{ width: pct(time) }} />
      {findings.map((f) => (
        <button
          key={f.id}
          className={`rl-mark is-${f.severity}`}
          style={{ left: pct(f.start), width: `max(6px, ${pct(f.end - f.start)})` }}
          title={`${f.title} at ${f.start.toFixed(1)} s`}
          aria-label={`${f.title} at ${f.start.toFixed(1)} seconds`}
          onPointerDown={(e) => {
            e.stopPropagation();
            seek(f.start, f);
          }}
        />
      ))}
      <span className="rl-timeline-cursor" style={{ left: pct(time) }} />
    </div>
  );
}

/* ---------- Page ---------- */
export function RobotLogs() {
  const [logs, setLogs] = useState<CloudLog[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState<Tab>("health");
  const [dragging, setDragging] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [poseMap, setPoseMap] = useState({ x: "", y: "", heading: "" });
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const atEnd = !!recording && time >= recording.duration;
  const activePlaying = playing && !atEnd;
  const worker = useRef<Worker | null>(null);
  const job = useRef(0);
  const source = useRef<{ blob: Blob; name: string; hash?: string } | null>(null);

  const loadLibrary = useCallback(async (before?: string) => {
    try {
      const data = await requestJSON(`/api/robot-logs${before ? `?before=${encodeURIComponent(before)}` : ""}`);
      setSummaries(readSummaries());
      setLogs((old) => (before ? [...old, ...data.logs] : data.logs));
      setNext(data.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    const instance = new Worker(new URL("./parse.worker.ts", import.meta.url));
    worker.current = instance;
    instance.onmessage = (event) => {
      if (event.data.id !== job.current) return;
      setBusy(false);
      if (event.data.error) {
        setError(event.data.error);
        return;
      }
      const r: Recording = event.data.recording;
      const a: Analysis = event.data.analysis;
      setRecording(r);
      setAnalysis(a);
      setTime(0);
      setTab(a.findings.length ? "health" : "power");
      if (source.current) source.current.hash = event.data.hash;
      setCurrentHash(event.data.hash);
      const summary = {
        errors: a.findings.filter((f) => f.severity === "error").length,
        warnings: a.findings.filter((f) => f.severity === "warning").length,
        minVoltage: a.power.minVoltage,
        duration: r.duration,
      };
      saveSummary(event.data.hash, summary);
      setSummaries((s) => ({ ...s, [event.data.hash]: summary }));
      const preferred = [a.mapping.voltage, a.mapping.current].filter(Boolean) as string[];
      setSelected(
        preferred.length
          ? preferred
          : r.channels
              .filter((c) => c.samples.length)
              .slice(0, 2)
              .map((c) => c.name),
      );
      const x = r.channels.find((c) => /(?:pose|odometry).*\/x$/i.test(c.name))?.name ?? "";
      const prefix = x.slice(0, -1);
      setPoseMap({
        x,
        y: r.channels.find((c) => c.name === `${prefix}y`)?.name ?? "",
        heading: r.channels.find((c) => c.name === `${prefix}heading`)?.name ?? "",
      });
    };
    instance.onerror = () => {
      setBusy(false);
      setError("The log reader stopped unexpectedly. Refresh this page to retry.");
    };
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    // Initial library load; the request's own state updates happen after it resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLibrary();
  }, [loadLibrary]);

  const openBlob = useCallback(async (blob: Blob, name: string, expectedHash?: string) => {
    if (blob.size > 250 * 1024 * 1024) throw new Error("Recordings larger than 250 MB can't be opened here yet.");
    setPlaying(false);
    setError("");
    setBusy(true);
    const id = ++job.current;
    source.current = { blob, name };
    setCurrentHash(null);
    const buffer = await blob.arrayBuffer();
    if (!worker.current) throw new Error("The log reader is not ready yet.");
    worker.current.postMessage({ id, buffer, name, expectedHash }, [buffer]);
  }, []);

  const openFile = async (file?: File) => {
    if (!file) return;
    try {
      await openBlob(file, file.name);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openCloud = useCallback(
    async (hash: string, signal?: AbortSignal) => {
      setBusy(true);
      setPlaying(false);
      setError("");
      try {
        const data = await requestJSON(`/api/robot-logs/${hash}/file`, { signal });
        const response = await fetch(data.url, { signal });
        if (!response.ok) throw new Error("Could not download the recording. Try again.");
        const blob = await response.blob();
        if (signal?.aborted) return;
        await openBlob(blob, data.name, hash);
        const url = new URL(location.href);
        url.searchParams.set("log", hash);
        history.replaceState(null, "", url);
      } catch (e) {
        if (signal?.aborted) return;
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [openBlob],
  );

  useEffect(() => {
    const hash = new URLSearchParams(location.search).get("log");
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void openCloud(hash, controller.signal);
    return () => controller.abort();
  }, [openCloud]);

  useEffect(() => {
    if (!activePlaying || !recording) return;
    let last = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      setTime((previous) => Math.min(recording.duration, previous + ((now - last) / 1000) * speed));
      last = now;
    }, 40);
    return () => clearInterval(interval);
  }, [activePlaying, recording, speed]);

  // Space plays/pauses, arrows step one second, when not typing.
  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,select,textarea,button,a")) return;
      if (e.key === " ") {
        e.preventDefault();
        if (time >= recording.duration) setTime(0);
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") setTime((t) => Math.min(recording.duration, t + 1));
      else if (e.key === "ArrowLeft") setTime((t) => Math.max(0, t - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recording, time]);

  const upload = async () => {
    const current = source.current;
    if (!current?.hash || uploading) return;
    setUploading(true);
    setError("");
    try {
      const plan = await requestJSON("/api/robot-logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: current.name, size: current.blob.size, sha256: current.hash }),
      });
      if (!plan.alreadyUploaded) {
        const response = await fetch(plan.uploadUrl, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: current.blob,
        });
        if (!response.ok) throw new Error(`File transfer failed (${response.status}). Retry to resume confirmation.`);
        await requestJSON("/api/robot-logs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ complete: true, sha256: current.hash }),
        });
      }
      await loadLibrary();
      const url = new URL(location.href);
      url.searchParams.set("log", current.hash);
      history.replaceState(null, "", url);
      setNotice("Uploaded. Teammates can open it from the library.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const seek = (t: number, finding?: Finding) => {
    setPlaying(false);
    setTime(t);
    if (finding) {
      setSelected((s) => [finding.channel, ...s.filter((n) => n !== finding.channel)].slice(0, 4));
      setTab("signals");
    }
  };
  const remap = (key: keyof PowerMapping, value: string) => {
    if (recording && analysis) setAnalysis(analyze(recording, { ...analysis.mapping, [key]: value || undefined }));
  };
  const channels = useMemo(() => new Map(recording?.channels.map((c) => [c.name, c]) ?? []), [recording]);
  const totalCurrent = analysis?.mapping.current;
  const breakdown = useMemo(
    () => (recording ? currentBreakdown(recording, totalCurrent) : []),
    [recording, totalCurrent],
  );
  const trail = useMemo(() => {
    const xs = channels.get(poseMap.x),
      ys = channels.get(poseMap.y);
    if (!xs || !ys) return "";
    const step = Math.max(1, Math.floor(xs.samples.length / 800));
    const points: string[] = [];
    for (let i = 0; i < xs.samples.length; i += step) {
      const s = xs.samples[i];
      const yv = valueAt(ys, s.time);
      if (typeof s.value === "number" && typeof yv === "number")
        points.push(`${s.value.toFixed(3)},${(FIELD.height - yv).toFixed(3)}`);
    }
    return points.join(" ");
  }, [channels, poseMap.x, poseMap.y]);

  const errors = analysis?.findings.filter((f) => f.severity === "error") ?? [];
  const warnings = analysis?.findings.filter((f) => f.severity === "warning") ?? [];
  const library = logs.filter((l) => l.name.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = library.reduce<[string, CloudLog[]][]>((acc, log) => {
    const label = dayLabel(log.created_at);
    const last = acc.at(-1);
    if (last && last[0] === label) last[1].push(log);
    else acc.push([label, [log]]);
    return acc;
  }, []);
  const inLibrary = !!currentHash && logs.some((l) => l.sha256 === currentHash);
  const px = valueAt(channels.get(poseMap.x), time),
    py = valueAt(channels.get(poseMap.y), time),
    heading = valueAt(channels.get(poseMap.heading), time);
  const voltage = channels.get(analysis?.mapping.voltage ?? "");
  const current = channels.get(analysis?.mapping.current ?? "");
  const vMin = analysis?.power.minVoltage;

  const fileInput = (
    <input
      type="file"
      accept=".wpilog"
      disabled={busy}
      onChange={(e) => {
        void openFile(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <div
      className={`rl ${dragging ? "is-dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void openFile(e.dataTransfer.files?.[0]);
      }}
    >
      <header className="rl-heading">
        <div>
          <p className="eyebrow">Software · FRC 3256</p>
          <h1 className="display text-3xl sm:text-4xl">Robot logs</h1>
          <p>Every recording is checked for brownouts, faults, disconnects and loop overruns as it opens.</p>
        </div>
        <div className="rl-heading-actions">
          <button className="btn btn-ghost" onClick={() => setConnecting(true)}>
            Connect Mayhem
          </button>
          <label className={`btn btn-primary ${busy ? "is-busy" : ""}`}>
            {busy ? "Reading…" : "Open a .wpilog"}
            {fileInput}
          </label>
        </div>
      </header>

      {error && (
        <div className="rl-alert is-bad" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="rl-alert is-good" role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}

      <div className="rl-layout">
        <aside className="rl-library card" aria-label="Team recordings">
          <div className="rl-library-head">
            <h2>Team library</h2>
            <button className="rl-link" onClick={() => void loadLibrary()}>
              Refresh
            </button>
          </div>
          <input
            className="input rl-filter"
            placeholder="Filter by name"
            aria-label="Filter team recordings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="rl-library-list">
            {loadingLibrary && <p className="rl-note">Loading recordings…</p>}
            {groups.map(([label, items]) => (
              <section key={label}>
                <h3>{label}</h3>
                {items.map((log) => {
                  const s = summaries[log.sha256];
                  return (
                    <div key={log.sha256} className={`rl-log ${currentHash === log.sha256 ? "is-active" : ""}`}>
                      <button disabled={busy} onClick={() => void openCloud(log.sha256)}>
                        <span className="rl-log-name">{log.name.replace(/\.wpilog$/i, "")}</span>
                        <span className="rl-log-meta">
                          {new Date(log.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
                          {mb(log.size)}
                          {s && ` · ${s.duration.toFixed(0)} s`}
                          {log.device?.name && ` · ${log.device.name}`}
                        </span>
                      </button>
                      {s ? (
                        s.errors ? (
                          <span className="pill pill-bad">{s.errors} red</span>
                        ) : s.warnings ? (
                          <span className="pill pill-warn">{s.warnings}</span>
                        ) : (
                          <span className="pill pill-good">clean</span>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ))}
            {!loadingLibrary && !library.length && (
              <p className="rl-note">
                {logs.length
                  ? "No recordings match."
                  : "Nothing uploaded yet. Use Connect Mayhem to let a laptop upload automatically, or open a file and upload it."}
              </p>
            )}
            {next && (
              <button className="btn btn-ghost rl-more" onClick={() => void loadLibrary(next)}>
                Load older recordings
              </button>
            )}
          </div>
          <p className="rl-note">Health badges appear once a recording has been opened on this device.</p>
        </aside>

        <section className="rl-content card">
          {recording && analysis ? (
            <>
              <div className="rl-title">
                <div>
                  <h2>{recording.name}</h2>
                  <p>
                    {recording.duration.toFixed(1)} s · {recording.channels.length} signals · analyzed in your browser
                  </p>
                </div>
                <div className="rl-title-actions">
                  {inLibrary && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        void navigator.clipboard?.writeText(location.href).then(() => setNotice("Link copied."));
                      }}
                    >
                      Copy link
                    </button>
                  )}
                  {inLibrary && (
                    <a className="btn btn-ghost" href={`/logs/advantagescope?log=${currentHash}`}>
                      Open in AdvantageScope
                    </a>
                  )}
                  {!inLibrary && (
                    <button className="btn btn-primary" disabled={uploading || busy || !currentHash} onClick={() => void upload()}>
                      {uploading ? "Uploading…" : "Upload to team"}
                    </button>
                  )}
                </div>
              </div>

              <div className={`rl-verdict is-${errors.length ? "bad" : warnings.length ? "warn" : "good"}`}>
                <strong>
                  {errors.length
                    ? `${errors.length} red ${errors.length === 1 ? "flag" : "flags"}${warnings.length ? ` and ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`
                    : warnings.length
                      ? `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"} to review`
                      : "No red flags"}
                </strong>
                <span>
                  Lowest battery {fixed(vMin)} V · peak draw {fixed(analysis.power.peakCurrent, 0)} A
                </span>
              </div>

              <div className="rl-transport">
                <button
                  className="rl-play"
                  aria-label={activePlaying ? "Pause recording" : "Play recording"}
                  onClick={() => {
                    if (time >= recording.duration) {
                      setTime(0);
                      setPlaying(true);
                    } else setPlaying((v) => !v);
                  }}
                >
                  {activePlaying ? (
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M4 2h3v12H4zM9 2h3v12H9z" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M4 2l10 6-10 6z" fill="currentColor" />
                    </svg>
                  )}
                </button>
                <code className="rl-clock">
                  {time.toFixed(1)}
                  <small> / {recording.duration.toFixed(1)} s</small>
                </code>
                <Timeline findings={analysis.findings} duration={recording.duration} time={time} seek={seek} />
                <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {[0.25, 0.5, 1, 2, 4].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </div>

              <div className="rl-tabs" role="tablist" aria-label="Report sections">
                {(
                  [
                    ["health", `Health${analysis.findings.length ? ` · ${analysis.findings.length}` : ""}`],
                    ["power", "Power"],
                    ["signals", "Signals"],
                    ["field", "Field"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? "is-active" : ""}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "health" && (
                <div className="rl-section">
                  {analysis.findings.length ? (
                    <div className="rl-findings">
                      {[...errors, ...warnings].map((f) => (
                        <button key={f.id} className={`rl-finding is-${f.severity}`} onClick={() => seek(f.start, f)}>
                          <span className={`pill ${f.severity === "error" ? "pill-bad" : "pill-warn"}`}>
                            {f.severity === "error" ? "Red flag" : "Warning"}
                          </span>
                          <strong>{f.title}</strong>
                          <p>{f.detail}</p>
                          <code>
                            {f.start.toFixed(2)}–{f.end.toFixed(2)} s · {f.channel}
                          </code>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rl-ok">No rule triggered. The notes below list what this log could not show.</p>
                  )}
                  <h3 className="rl-subhead">What this log could and couldn&apos;t show</h3>
                  <ul className="rl-coverage">
                    {[...recording.warnings, ...analysis.coverage].map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {tab === "power" && (
                <div className="rl-section">
                  <div className="rl-stats">
                    <div className={vMin === undefined ? "" : vMin < 7 ? "is-bad" : vMin < 9 ? "is-warn" : "is-good"}>
                      <span>Lowest battery</span>
                      <strong>
                        {fixed(vMin)}
                        <small>V</small>
                      </strong>
                    </div>
                    <div>
                      <span>Peak total draw</span>
                      <strong>
                        {fixed(analysis.power.peakCurrent, 0)}
                        <small>A</small>
                      </strong>
                    </div>
                    <div>
                      <span>Average power</span>
                      <strong>
                        {fixed(analysis.power.averagePower, 0)}
                        <small>W</small>
                      </strong>
                    </div>
                    <div>
                      <span>Energy used</span>
                      <strong>
                        {fixed(analysis.power.energyWh)}
                        <small>Wh</small>
                      </strong>
                    </div>
                  </div>
                  {voltage ? (
                    <Chart
                      label="Battery voltage"
                      channel={voltage}
                      overlay={current}
                      duration={recording.duration}
                      time={time}
                      seek={seek}
                      threshold={{ value: 6.8, label: "brownout 6.8 V" }}
                      findings={analysis.findings.filter(
                        (f) => f.channel === voltage.name || f.channel === analysis.mapping.brownout,
                      )}
                    />
                  ) : (
                    <p className="rl-note">Choose the battery voltage signal below to graph voltage sag.</p>
                  )}
                  <h3 className="rl-subhead">Biggest current draws</h3>
                  {breakdown.length ? (
                    <div className="rl-bars">
                      {breakdown.map((b) => (
                        <button
                          key={b.channel}
                          onClick={() => {
                            setSelected((s) => [b.channel, ...s.filter((n) => n !== b.channel)].slice(0, 4));
                            setTab("signals");
                          }}
                        >
                          <span className="rl-bar-name">{b.channel}</span>
                          <span className="rl-bar-track">
                            <i style={{ width: `${(b.mAh / breakdown[0].mAh) * 100}%` }} />
                          </span>
                          <code>{b.mAh.toFixed(0)} mAh</code>
                          <code className="rl-muted">peak {b.peak.toFixed(0)} A</code>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rl-note">
                      No per-motor current signals in this log. Log each motor&apos;s supply current to see which mechanisms
                      drain the battery.
                    </p>
                  )}
                  <h3 className="rl-subhead">Signal mapping</h3>
                  <div className="rl-mapping">
                    {(["voltage", "current", "brownout"] as const).map((key) => (
                      <label key={key}>
                        <span className="label">
                          {key === "voltage" ? "Battery voltage" : key === "current" ? "Total current" : "Brownout flag"}
                        </span>
                        <select className="input" value={analysis.mapping[key] ?? ""} onChange={(e) => remap(key, e.target.value)}>
                          <option value="">Not recorded</option>
                          {recording.channels
                            .filter(
                              (c) => c.samples.length && (key === "brownout" ? c.type === "boolean" : numeric.includes(c.type)),
                            )
                            .map((c) => (
                              <option key={c.name}>{c.name}</option>
                            ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {tab === "signals" && (
                <div className="rl-section rl-signals">
                  <aside>
                    <input
                      className="input"
                      aria-label="Search log signals"
                      placeholder="Find a signal"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="rl-signal-list">
                      {recording.channels
                        .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
                        .slice(0, 300)
                        .map((c) => {
                          const on = selected.includes(c.name);
                          return (
                            <label key={c.name} className={on ? "is-on" : ""}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={!on && selected.length >= 4}
                                onChange={(e) =>
                                  setSelected((previous) =>
                                    e.target.checked ? [...previous, c.name] : previous.filter((n) => n !== c.name),
                                  )
                                }
                              />
                              <span>{c.name}</span>
                              <code>{String(valueAt(c, time) ?? "—").slice(0, 10)}</code>
                            </label>
                          );
                        })}
                    </div>
                    <p className="rl-note">Up to four signals, sharing one cursor.</p>
                  </aside>
                  <div className="rl-plots">
                    {selected.map((name, i) => {
                      const c = channels.get(name);
                      return c ? (
                        <Chart
                          key={name}
                          label={name}
                          channel={c}
                          duration={recording.duration}
                          time={time}
                          seek={seek}
                          color={palette[i % palette.length]}
                          height={150}
                          findings={analysis.findings.filter((f) => f.channel === name)}
                        />
                      ) : null;
                    })}
                    {!selected.length && <p className="rl-note">Tick signals on the left to graph them.</p>}
                  </div>
                </div>
              )}

              {tab === "field" && (
                <div className="rl-section">
                  <div className="rl-mapping">
                    {(["x", "y", "heading"] as const).map((key) => (
                      <label key={key}>
                        <span className="label">{key === "heading" ? "Heading (rad)" : `${key.toUpperCase()} position (m)`}</span>
                        <select
                          className="input"
                          value={poseMap[key]}
                          onChange={(e) => setPoseMap((old) => ({ ...old, [key]: e.target.value }))}
                        >
                          <option value="">Not mapped</option>
                          {recording.channels
                            .filter((c) => c.samples.length && numeric.includes(c.type))
                            .map((c) => (
                              <option key={c.name}>{c.name}</option>
                            ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  {typeof px === "number" && typeof py === "number" ? (
                    <svg
                      viewBox={`-.3 -.3 ${FIELD.width + 0.6} ${FIELD.height + 0.6}`}
                      aria-label="Recorded robot pose"
                      className="rl-field"
                    >
                      <image href="/fields/rebuilt-2026.svg" width={FIELD.width} height={FIELD.height} />
                      {trail && (
                        <polyline
                          points={trail}
                          fill="none"
                          stroke="var(--purple)"
                          strokeOpacity=".35"
                          strokeWidth=".08"
                          strokeLinejoin="round"
                        />
                      )}
                      <g
                        transform={`translate(${px},${FIELD.height - py}) rotate(${(-(typeof heading === "number" ? heading : 0) * 180) / Math.PI})`}
                      >
                        <rect x="-.42" y="-.42" width=".84" height=".84" rx=".08" fill="var(--purple)" />
                        <path d="M-.1,-.2 L.2,0 L-.1,.2" stroke="white" strokeWidth=".06" fill="none" />
                      </g>
                    </svg>
                  ) : (
                    <p className="rl-note">Choose recorded X and Y position signals to replay the robot on the field.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <label className="rl-empty">
              <span className="rl-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24">
                  <path
                    d="M12 16V4m0 0l-4 4m4-4l4 4M5 20h14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <h2>{busy ? "Reading the recording…" : "Pick a recording from the library"}</h2>
              <p>Or drop a .wpilog anywhere on this page. Files you open stay on your device until you upload them.</p>
              {fileInput}
            </label>
          )}
        </section>
      </div>
      {connecting && <ConnectMayhem onClose={() => setConnecting(false)} />}
      {dragging && (
        <div className="rl-drop" aria-hidden="true">
          Drop the .wpilog to open it
        </div>
      )}
    </div>
  );
}
