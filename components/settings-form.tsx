"use client";

import { useState, useTransition, type FormEvent } from "react";
import { updateSettings } from "@/app/actions";
import type { Settings } from "@/lib/types";

const FIELDS: { key: keyof Settings; label: string; unit: string; hint: string }[] = [
  { key: "min_rest_after_charge_min", label: "Min rest after charge", unit: "min", hint: "Don't recommend a battery until it has rested this long" },
  { key: "max_charge_duration_min", label: "Max charge duration", unit: "min", hint: "Flag “charging too long” past this" },
  { key: "ir_warn_mohm", label: "IR: reserve from", unit: "mΩ", hint: "Below this is comp-ready; at or above is reserve" },
  { key: "ir_practice_mohm", label: "IR: practice-only from", unit: "mΩ", hint: "At or above → suggest marking practice-only" },
  { key: "ir_suspect_mohm", label: "IR: suspect from", unit: "mΩ", hint: "At or above → suspect (still practice-only)" },
  { key: "ir_fail_mohm", label: "IR: retire from", unit: "mΩ", hint: "At or above → suggest retiring; IR score hits 0 here" },
  { key: "load_test_min_v", label: "Load test floor", unit: "V", hint: "100 A load test fails if the loaded voltage is below this" },
  { key: "capacity_warn_pct", label: "Capacity warn", unit: "%", hint: "CBA measured / rated below this → warn" },
  { key: "capacity_fail_pct", label: "Capacity fail", unit: "%", hint: "Below this → recommend retire (used when a CBA has no Wh)" },
  { key: "cba_a_wh", label: "CBA A-tier from", unit: "Wh", hint: "At or above → A-tier (green)" },
  { key: "cba_b_wh", label: "CBA B-tier from", unit: "Wh", hint: "At or above → B-tier; below → C-tier (recommend refresh/retire)" },
  { key: "peukert_k", label: "Peukert exponent", unit: "k", hint: "Rate-corrects rated Ah for high-current CBA tests: ≈1.2 lead-acid, ≈1.05 lithium, 1.0 = off" },
  { key: "cba_max_temp_c", label: "CBA max battery temp", unit: "°C", hint: "External probe reading at or above this during a discharge → warn" },
  { key: "max_cycles_warn", label: "Max cycles", unit: "cycles", hint: "Age warning; cycle score hits 0 here" },
];

function useAction(action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setMsg(null);
    start(async () => {
      const r = await action(fd);
      setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
      if (r.ok && form.dataset.reset === "1") form.reset();
    });
  }
  return { pending, msg, submit };
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const s = useAction(updateSettings);

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <form onSubmit={s.submit} className="card p-4 sm:p-5 flex flex-col gap-4">
        <p className="eyebrow" style={{ color: "var(--muted)" }}>Thresholds</p>
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="label">{f.label}</span>
            <div className="flex items-center gap-2">
              <input
                name={f.key}
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                className="input mono"
                defaultValue={settings[f.key] as number}
              />
              <span className="mono text-xs w-12 shrink-0" style={{ color: "var(--muted)" }}>{f.unit}</span>
            </div>
            <span className="block mt-1 text-xs" style={{ color: "var(--muted)" }}>{f.hint}</span>
          </label>
        ))}
        {s.msg && (
          <p className="text-sm font-medium" style={{ color: s.msg.ok ? "var(--good)" : "var(--bad)" }}>{s.msg.text}</p>
        )}
        <button type="submit" disabled={s.pending} className="btn btn-primary py-3">
          {s.pending ? "Saving…" : "Save thresholds"} <span aria-hidden>→</span>
        </button>
      </form>

      <div className="flex flex-col gap-6">
        <div className="card p-4 sm:p-5 flex flex-col gap-3">
          <p className="eyebrow" style={{ color: "var(--muted)" }}>Google account access</p>
          <p className="text-sm">All team tools use your Google account. Team admins manage accounts and roles from Home.</p>

        </div>

        <form action="/api/logout" method="post" className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="eyebrow" style={{ color: "var(--muted)" }}>This device</p>
            <p className="text-sm">Sign out of all team tools on this device.</p>
          </div>
          <button type="submit" className="btn btn-ghost text-sm shrink-0">Sign out</button>
        </form>
      </div>
    </div>
  );
}
