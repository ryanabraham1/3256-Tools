"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Device {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function when(iso: string | null) {
  if (!iso) return "Never used";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 2) return "Used just now";
  if (minutes < 60) return `Used ${minutes} min ago`;
  if (minutes < 60 * 24) return `Used ${Math.round(minutes / 60)} h ago`;
  return `Used ${new Date(iso).toLocaleDateString()}`;
}

/** Create, copy and revoke Mayhem desktop upload tokens. */
export function ConnectMayhem({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await request("/api/robot-logs/devices");
      setDevices(data.devices);
    } catch (e) {
      setDevices([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal?.();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => element?.close?.();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await request("/api/robot-logs/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setCreated({ name: data.device.name, token: data.token });
      setCopied(false);
      setName("");
      setDevices((d) => [data.device, ...(d ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (device: Device) => {
    setBusy(true);
    setError("");
    try {
      await request(`/api/robot-logs/devices/${device.id}`, { method: "DELETE" });
      setDevices((d) => (d ?? []).filter((x) => x.id !== device.id));
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="rl-dialog" aria-label="Connect Mayhem" onCancel={onClose}>
      <header className="rl-dialog-head">
        <div>
          <h2>Connect Mayhem</h2>
          <p>Give each laptop its own upload token. Mayhem then uploads robot logs here automatically.</p>
        </div>
        <button className="rl-dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {error && (
        <p className="rl-alert is-bad" role="alert">
          {error}
        </p>
      )}

      {created ? (
        <section className="rl-token">
          <h3>Token for {created.name}</h3>
          <p>Copy it now. For security it is not shown again; create a new one if it&apos;s lost.</p>
          <div className="rl-token-value">
            <code>{created.token}</code>
            <button
              className="btn btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(created.token).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <ol className="rl-steps">
            <li>
              In Mayhem, open <strong>Robot</strong> and find <strong>Team upload</strong>.
            </li>
            <li>
              Paste the token into <strong>Device upload token</strong> and turn on{" "}
              <strong>Remember the token on this computer</strong>.
            </li>
            <li>
              Turn on <strong>Upload new logs automatically</strong>.
            </li>
          </ol>
          <button className="btn btn-ghost" onClick={() => setCreated(null)}>
            Done
          </button>
        </section>
      ) : (
        <form
          className="rl-new-device"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <label>
            <span className="label">Device name</span>
            <input
              className="input"
              autoFocus
              maxLength={60}
              placeholder="e.g. Pit laptop"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            Create token
          </button>
        </form>
      )}

      <section className="rl-devices">
        <h3>Connected devices</h3>
        {devices === null && <p className="rl-note">Loading…</p>}
        {devices?.length === 0 && <p className="rl-note">No devices yet.</p>}
        {devices?.map((device) => (
          <div key={device.id} className="rl-device">
            <div>
              <strong>{device.name}</strong>
              <span>
                {when(device.last_used_at)} · added {new Date(device.created_at).toLocaleDateString()}
              </span>
            </div>
            {confirming === device.id ? (
              <div className="rl-device-confirm">
                <button className="btn btn-danger" disabled={busy} onClick={() => void revoke(device)}>
                  Revoke
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </div>
            ) : (
              <button className="rl-link is-danger" onClick={() => setConfirming(device.id)}>
                Revoke…
              </button>
            )}
          </div>
        ))}
        <p className="rl-note">
          Revoking stops that laptop from uploading right away. Logs it already uploaded stay in the library. Tokens
          can only upload; viewing logs still needs the team sign-in.
        </p>
      </section>
    </dialog>
  );
}
