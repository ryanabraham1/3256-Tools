"use client";
import { useEffect, useRef, useState } from "react";

const MAX_BYTES = 250 * 1024 * 1024;
export function AdvantageScope({ log }: { log: string | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Starting AdvantageScope…");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "team-scope-ready") {
        clearInterval(timer);
        setReady(true);
        setStatus(log ? "Loading team recording…" : "Choose a local WPILOG or open a recording from the team library.");
      }
      if (event.data?.type === "team-scope-opened") setStatus(event.data.name);
    }
    window.addEventListener("message", receive);
    // Covers cached frames which finish before React attaches its listener.
    const timer = window.setInterval(() => frame.current?.contentWindow?.postMessage({ type: "team-scope-ping" }, location.origin), 1000);
    return () => { window.removeEventListener("message", receive); clearInterval(timer); };
  }, [log]);
  function open(bytes: ArrayBuffer, name: string) {
    if (bytes.byteLength > MAX_BYTES) throw new Error("This recording exceeds the 250 MB limit.");
    frame.current?.contentWindow?.postMessage({ type: "team-scope-open", bytes, name }, location.origin, [bytes]);
  }
  useEffect(() => {
    if (!ready || !log) return;
    const controller = new AbortController();
    async function load() {
      try {
        const metadata = await fetch(`/api/robot-logs/${log}/file`, { signal: controller.signal, cache: "no-store" });
        const info = await metadata.json();
        if (!metadata.ok) throw new Error(info.error || "Could not open recording.");
        const response = await fetch(info.url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not download recording. Try again.");
        const size = Number(response.headers.get("content-length"));
        if (size > MAX_BYTES) throw new Error("Recording exceeds the 250 MB limit.");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > MAX_BYTES) throw new Error("Recording exceeds the 250 MB limit.");
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
        if (hash !== log) throw new Error("Recording integrity check failed. Try downloading again.");
        if (!controller.signal.aborted) open(bytes, info.name);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    return () => controller.abort();
  }, [ready, log, retry]);
  return <div className="scope-shell">
    <header className="scope-toolbar">
      <a className="btn btn-sm" href="/logs">← Robot logs</a>
      <strong>AdvantageScope <small>Lite · preview</small></strong>
      <label className="btn btn-sm">Open local WPILOG<input hidden type="file" accept=".wpilog" disabled={!ready} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        setError("");
        try { if (file.size > MAX_BYTES) throw new Error("Recording exceeds the 250 MB limit."); open(await file.arrayBuffer(), file.name); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      }} /></label>
      <span className="scope-status" role="status">{status}</span>
      <a href="/advantagescope/LICENSE" target="_blank" rel="noreferrer">Littleton Robotics · License</a>
    </header>
    {error && <div className="scope-error" role="alert">{error} <button className="btn btn-sm" onClick={() => {setError(""); setRetry(n => n + 1);}}>Retry</button></div>}
    <iframe ref={frame} src="/advantagescope/index.html" title="AdvantageScope Lite log viewer" className="scope-frame" allow="fullscreen" />
  </div>;
}
