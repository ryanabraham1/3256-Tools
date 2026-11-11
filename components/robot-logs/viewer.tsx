"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { plotSeries } from "@/lib/robot-logs/core/plot";
import {
  analyze,
  valueAt,
  type Analysis,
  type Channel,
  type PowerMapping,
  type Recording,
} from "@/lib/robot-logs/core/analysis";
interface CloudLog {
  sha256: string;
  name: string;
  size: number;
  created_at: string;
}
const number = (n: number | undefined, unit: string) =>
  n === undefined ? "Not recorded" : `${n.toFixed(2)} ${unit}`;
const palette = ["#6c53dd", "#158a83", "#d48c30", "#cc5680"];
async function requestJSON(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function SignalPlot({
  channel,
  duration,
  time,
  color,
}: {
  channel: Channel;
  duration: number;
  time: number;
  color: string;
}) {
  const { samples, min, max } = useMemo(() => plotSeries(channel), [channel]);
  const points = useMemo(
    () =>
      samples
        .map(
          (s) =>
            `${10 + (s.time / Math.max(duration, 0.001)) * 780},${110 - ((Number(s.value) - min) / Math.max(max - min, 0.001)) * 90}`,
        )
        .join(" "),
    [samples, min, max, duration],
  );
  return (
    <div className="rl-plot">
      <div>
        <strong style={{ color }}>{channel.name}</strong>
        <code>{String(valueAt(channel, time) ?? "No sample")}</code>
      </div>
      {samples.length ? (
        <svg viewBox="0 0 800 130" aria-label={`${channel.name} over time`}>
          <path d="M10,10 V115 H790" stroke="var(--line)" fill="none" />
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
          />
          <path
            d={`M${10 + (time / Math.max(duration, 0.001)) * 780},10 V115`}
            stroke="var(--warn)"
            strokeDasharray="4 3"
          />
          <text x="15" y="125" fontSize="9" fill="var(--muted)">
            {min.toFixed(2)} — {max.toFixed(2)}
          </text>
        </svg>
      ) : (
        <p className="rl-note">
          {channel.samples.length
            ? "Value at the selected playback time is shown above."
            : "No decoded samples for this data type."}
        </p>
      )}
    </div>
  );
}
export function RobotLogs() {
  const [logs, setLogs] = useState<CloudLog[]>([]),
    [next, setNext] = useState<string | null>(null),
    [recording, setRecording] = useState<Recording | null>(null),
    [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const [poseMap, setPoseMap] = useState({ x: "", y: "", heading: "" }),
    [field, setField] = useState({ width: 16.54, height: 8.07 });
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const atEnd = !!recording && time >= recording.duration;
  const activePlaying = playing && !atEnd;
  const worker = useRef<Worker | null>(null),
    job = useRef(0),
    source = useRef<{ blob: Blob; name: string; hash?: string } | null>(null);
  const loadLibrary = useCallback(async (before?: string) => {
    try {
      const data = await requestJSON(
        `/api/robot-logs${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      );
      setLogs((old) => (before ? [...old, ...data.logs] : data.logs));
      setNext(data.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setRecording(r);
      setAnalysis(event.data.analysis);
      setTime(0);
      if (source.current) source.current.hash = event.data.hash;
      setCurrentHash(event.data.hash);
      const preferred = [
        event.data.analysis.mapping.voltage,
        event.data.analysis.mapping.current,
      ].filter(Boolean) as string[];
      setSelected(
        preferred.length
          ? preferred
          : r.channels
              .filter((c) => c.samples.length)
              .slice(0, 2)
              .map((c) => c.name),
      );
      const x =
        r.channels.find((c) => /(?:pose|odometry).*\/x$/i.test(c.name))?.name ??
        "";
      const prefix = x.slice(0, -1);
      setPoseMap({
        x,
        y: r.channels.find((c) => c.name === `${prefix}y`)?.name ?? "",
        heading:
          r.channels.find((c) => c.name === `${prefix}heading`)?.name ?? "",
      });
    };
    instance.onerror = () => {
      setBusy(false);
      setError(
        "The log reader stopped unexpectedly. Refresh this page to retry.",
      );
    };
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    requestJSON("/api/robot-logs")
      .then((data) => {
        if (!cancelled) {
          setLogs(data.logs);
          setNext(data.next);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const openBlob = useCallback(
    async (blob: Blob, name: string, expectedHash?: string) => {
      if (blob.size > 250 * 1024 * 1024)
        throw new Error("Current recording limit is 250 MB.");
      setPlaying(false);
      setError("");
      setBusy(true);
      const id = ++job.current;
      source.current = { blob, name };
      setCurrentHash(null);
      const buffer = await blob.arrayBuffer();
      if (!worker.current)
        throw new Error("The recording reader is not ready.");
      worker.current.postMessage({ id, buffer, name, expectedHash }, [buffer]);
    },
    [],
  );
  const openCloud = useCallback(
    async (hash: string) => {
      setBusy(true);
      setPlaying(false);
      setError("");
      try {
        const data = await requestJSON(`/api/robot-logs/${hash}/file`);
        const response = await fetch(data.url);
        if (!response.ok)
          throw new Error("Could not download the recording. Try again.");
        await openBlob(await response.blob(), data.name, hash);
        const url = new URL(location.href);
        url.searchParams.set("log", hash);
        history.replaceState(null, "", url);
      } catch (e) {
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
    const requestJob = ++job.current;
    requestJSON(`/api/robot-logs/${hash}/file`, { signal: controller.signal })
      .then(async (data) => {
        const response = await fetch(data.url, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not download the recording.");
        const blob = await response.blob();
        if (!controller.signal.aborted && requestJob === job.current)
          await openBlob(blob, data.name, hash);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [openBlob]);
  useEffect(() => {
    if (!activePlaying || !recording) return;
    let last = performance.now();
    const interval = setInterval(() => {
      const now = performance.now(),
        dt = (now - last) / 1000;
      last = now;
      setTime((previous) =>
        Math.min(recording.duration, previous + dt * speed),
      );
    }, 40);
    return () => clearInterval(interval);
  }, [activePlaying, recording, speed]);

  const upload = async () => {
    const current = source.current;
    if (!current?.hash || uploading) return;
    setUploading(true);
    setError("");
    try {
      const plan = await requestJSON("/api/robot-logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: current.name,
          size: current.blob.size,
          sha256: current.hash,
        }),
      });
      if (!plan.alreadyUploaded) {
        const response = await fetch(plan.uploadUrl, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: current.blob,
        });
        if (!response.ok)
          throw new Error(
            `File transfer failed (${response.status}). Retry to resume confirmation.`,
          );
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };
  const remap = (key: keyof PowerMapping, value: string) => {
    if (recording && analysis)
      setAnalysis(
        analyze(recording, { ...analysis.mapping, [key]: value || undefined }),
      );
  };
  const channels = useMemo(
    () => new Map(recording?.channels.map((c) => [c.name, c]) ?? []),
    [recording],
  );
  const x = valueAt(channels.get(poseMap.x), time),
    y = valueAt(channels.get(poseMap.y), time),
    heading = valueAt(channels.get(poseMap.heading), time);
  return (
    <div className="rl">
      <header className="rl-heading">
        <div>
          <p className="eyebrow">Software · FRC 3256</p>
          <h1 className="display text-4xl sm:text-5xl">Robot logs</h1>
          <p>Replay a run. Follow the signals. See what happened.</p>
        </div>
        <a className="btn btn-primary" href="/logs/advantagescope">Open AdvantageScope</a>
        <label className="btn btn-primary">
          {busy ? "Reading recording…" : "Open local WPILOG"}
          <input
            type="file"
            accept=".wpilog"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file)
                try {
                  await openBlob(file, file.name);
                } catch (e) {
                  setBusy(false);
                  setError(String(e));
                }
              e.target.value = "";
            }}
          />
        </label>
      </header>
      {error && (
        <div className="rl-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <div className="rl-layout">
        <aside className="rl-library">
          <div className="rl-panel-title">
            <h2>Team recordings</h2>
            <button
              className="btn btn-sm"
              onClick={() => {
                void loadLibrary();
              }}
            >
              Refresh
            </button>
          </div>
          <p className="rl-note">
            Shared with signed-in teammates. Local files stay private until you
            upload them.
          </p>
          {logs.map((log) => (
            <div key={log.sha256}>
            <button
              disabled={busy}
              className={`rl-library-log ${currentHash === log.sha256 ? "active" : ""}`}
              onClick={() => {
                void openCloud(log.sha256);
              }}
            >
              <strong>{log.name}</strong>
              <span>
                {new Date(log.created_at).toLocaleString()} ·{" "}
                {(log.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </button>
            <a className="btn btn-sm" href={`/logs/advantagescope?log=${log.sha256}`}>Open in AdvantageScope</a>
            </div>
          ))}
          {!logs.length && (
            <p className="rl-note">
              Uploaded recordings will appear here. You can also open a file
              directly from your computer.
            </p>
          )}
          {next && (
            <button
              className="btn btn-sm"
              onClick={() => {
                void loadLibrary(next);
              }}
            >
              Load older recordings
            </button>
          )}
        </aside>
        <section className="rl-content">
          {recording && analysis ? (
            <>
              <div className="rl-recording-title">
                <div>
                  <h2>{recording.name}</h2>
                  <p>
                    {recording.duration.toFixed(2)} seconds ·{" "}
                    {recording.channels.length} channels · parsed in your
                    browser
                  </p>
                </div>
                <button
                  className="btn btn-sm"
                  disabled={uploading || busy || !currentHash}
                  onClick={() => {
                    void upload();
                  }}
                >
                  {uploading ? "Uploading…" : "Upload to team"}
                </button>
              </div>
              <div className="rl-playback">
                <button
                  className="btn btn-primary"
                  aria-label={
                    activePlaying ? "Pause recording" : "Play recording"
                  }
                  onClick={() => {
                    if (time >= recording.duration) {
                      setTime(0);
                      setPlaying(true);
                    } else setPlaying((v) => !v);
                  }}
                >
                  {activePlaying ? "Ⅱ Pause" : "▶ Play"}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setPlaying(false);
                    setTime(0);
                  }}
                >
                  Reset
                </button>
                <input
                  type="range"
                  aria-label="Playback time"
                  min="0"
                  max={recording.duration}
                  value={time}
                  step=".01"
                  onChange={(e) => {
                    setPlaying(false);
                    setTime(Number(e.target.value));
                  }}
                />
                <code>
                  {time.toFixed(2)} / {recording.duration.toFixed(2)} s
                </code>
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[0.25, 0.5, 1, 2, 4].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </div>
              <div className="rl-stats">
                {[
                  ["Minimum voltage", number(analysis.power.minVoltage, "V")],
                  ["Peak current", number(analysis.power.peakCurrent, "A")],
                  [
                    "Energy in overlapping data",
                    number(analysis.power.energyWh, "Wh"),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <details className="rl-mapping">
                <summary>Power signal mapping</summary>
                <div>
                  {(["voltage", "current", "brownout"] as const).map((key) => (
                    <label key={key}>
                      {key}
                      <select
                        value={analysis.mapping[key] ?? ""}
                        onChange={(e) => remap(key, e.target.value)}
                      >
                        <option value="">Not recorded</option>
                        {recording.channels
                          .filter((c) => c.samples.length)
                          .map((c) => (
                            <option key={c.name}>{c.name}</option>
                          ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
              <div className="rl-inspect">
                <aside className="rl-signals">
                  <h3>Signals</h3>
                  <input
                    aria-label="Search log signals"
                    placeholder="Find a signal…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div>
                    {recording.channels
                      .filter((c) =>
                        c.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .slice(0, 300)
                      .map((c) => (
                        <label key={c.name}>
                          <input
                            type="checkbox"
                            checked={selected.includes(c.name)}
                            disabled={
                              !selected.includes(c.name) && selected.length >= 4
                            }
                            onChange={(e) =>
                              setSelected((previous) =>
                                e.target.checked
                                  ? [...previous, c.name]
                                  : previous.filter((n) => n !== c.name),
                              )
                            }
                          />
                          <span>
                            {c.name}
                            <code>{String(valueAt(c, time) ?? "—")}</code>
                          </span>
                        </label>
                      ))}
                  </div>
                  <p className="rl-note">
                    Up to four signals at once. Search narrows the first 300
                    displayed channels.
                  </p>
                </aside>
                <div className="rl-plots">
                  {selected.map((name, i) => {
                    const c = channels.get(name);
                    return c ? (
                      <SignalPlot
                        key={name}
                        channel={c}
                        duration={recording.duration}
                        time={time}
                        color={palette[i % palette.length]}
                      />
                    ) : null;
                  })}
                  {!selected.length && (
                    <p className="rl-note">
                      Select signals to graph them at the shared playback time.
                    </p>
                  )}
                </div>
              </div>
              <details className="rl-field" open={!!poseMap.x && !!poseMap.y}>
                <summary>Field replay</summary>
                <p className="rl-note">
                  Map X/Y in meters and heading in radians. Field dimensions are
                  configurable; this is a coordinate view without season
                  obstacles.
                </p>
                <div className="rl-pose-mapping">
                  {(["x", "y", "heading"] as const).map((key) => (
                    <label key={key}>
                      {key}
                      <select
                        value={poseMap[key]}
                        onChange={(e) =>
                          setPoseMap((old) => ({
                            ...old,
                            [key]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Not mapped</option>
                        {recording.channels
                          .filter(
                            (c) =>
                              c.samples.length &&
                              ["double", "float", "int64", "number"].includes(
                                c.type,
                              ),
                          )
                          .map((c) => (
                            <option key={c.name}>{c.name}</option>
                          ))}
                      </select>
                    </label>
                  ))}
                  {(["width", "height"] as const).map((key) => (
                    <label key={key}>
                      Field {key} (m)
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={field[key]}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (n > 0 && n <= 100)
                            setField((f) => ({ ...f, [key]: n }));
                        }}
                      />
                    </label>
                  ))}
                </div>
                {typeof x === "number" && typeof y === "number" ? (
                  <svg
                    viewBox={`-.5 -.5 ${field.width + 1} ${field.height + 1}`}
                    aria-label="Recorded robot pose"
                    className="rl-field-svg"
                  >
                    <rect
                      width={field.width}
                      height={field.height}
                      fill="var(--neutral-soft)"
                      stroke="var(--line)"
                      strokeWidth=".04"
                    />
                    <image
                      href="/fields/rebuilt-2026.svg"
                      width={field.width}
                      height={field.height}
                    />
                    <path
                      d={`M${field.width / 2},0 V${field.height}`}
                      stroke="var(--line)"
                      strokeWidth=".04"
                      strokeDasharray=".2 .2"
                    />
                    <g
                      transform={`translate(${x},${field.height - y}) rotate(${(-(typeof heading === "number" ? heading : 0) * 180) / Math.PI})`}
                    >
                      <rect
                        x="-.42"
                        y="-.42"
                        width=".84"
                        height=".84"
                        rx=".08"
                        fill="var(--purple)"
                      />
                      <path
                        d="M-.1,-.2 L.2,0 L-.1,.2"
                        stroke="white"
                        strokeWidth=".06"
                        fill="none"
                      />
                    </g>
                  </svg>
                ) : (
                  <p className="rl-note">
                    Choose recorded position signals to show the robot here.
                  </p>
                )}
              </details>
              <section className="rl-findings">
                <h3>Power findings</h3>
                {analysis.findings.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setPlaying(false);
                      setTime(f.start);
                      setSelected([f.channel]);
                    }}
                  >
                    <strong>
                      {f.title}
                      <code>
                        {f.start.toFixed(2)}–{f.end.toFixed(2)} s
                      </code>
                    </strong>
                    <p>{f.detail}</p>
                  </button>
                ))}
                {!analysis.findings.length && (
                  <p className="rl-note">
                    No configured power rules triggered. This does not establish
                    that the robot had no faults.
                  </p>
                )}
                <details>
                  <summary>Logging coverage & reader limitations</summary>
                  {[...recording.warnings, ...analysis.coverage].map((w, i) => (
                    <p className="rl-note" key={i}>
                      {w}
                    </p>
                  ))}
                </details>
              </section>
            </>
          ) : (
            <div className="rl-empty">
              <span>↗</span>
              <h2>Bring a robot run into view.</h2>
              <p>
                Choose a team recording or open a WPILOG. Signals, pose
                playback, and power findings share one timeline.
              </p>
              <small>
                Parsing and analysis happen in a background worker on your
                device.
              </small>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
