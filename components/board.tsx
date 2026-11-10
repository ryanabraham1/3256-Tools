"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { sortReady, type BatteryWithHealth } from "@/lib/health";
import { STATES, STATE_LABEL, STATE_TONE, type BatteryState, type Settings } from "@/lib/types";
import { BatteryActionSheet, useBatteryActions } from "./battery-actions";
import { BatteryCard, restRemaining } from "./battery-card";
import { useCompMode } from "./comp-mode";
import { copyText, useContextMenu, type MenuEntry } from "./context-menu";
import { useOffline } from "./offline";
import { BoltIcon, Empty, HealthPill } from "./ui";
import { fmtNum, timeAgo } from "@/lib/format";

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Board({ items, settings }: { items: BatteryWithHealth[]; settings: Settings }) {
  const sp = useSearchParams();
  const router = useRouter();
  const menu = useContextMenu();
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const now = useNow();
  const actions = useBatteryActions();
  const { compMode, matchLabel } = useCompMode();
  const { run, pendingState, outbox } = useOffline();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Phones show one column at a time; the tab strip picks which. Desktop shows all five.
  const [tab, setTab] = useState<BatteryState>("ready");

  const columns = useMemo(() => {
    // Queued (offline) changes show their resulting state immediately.
    const overlaid = outbox.length
      ? items.map((i) => {
          const s = pendingState(i.battery.id, i.battery.state);
          return s && s !== i.battery.state ? { ...i, battery: { ...i.battery, state: s } } : i;
        })
      : items;
    const live = overlaid.filter((i) => i.battery.status !== "retired");
    const filtered = q ? live.filter((i) => i.battery.name.toLowerCase().includes(q)) : live;
    const by: Record<BatteryState, BatteryWithHealth[]> = {
      ready: [],
      in_robot: [],
      charging: [],
      needs_attention: [],
    };
    for (const i of filtered) by[i.battery.state].push(i);
    // recompute rest with the live clock so ordering updates as time passes
    by.ready = sortReady(
      by.ready.map((i) => ({
        ...i,
        health: { ...i.health, restRemainingMin: restRemaining(i, now) },
      })),
    );
    for (const s of STATES) if (s !== "ready") by[s].sort((a, b) => a.battery.state_changed_at.localeCompare(b.battery.state_changed_at));
    return by;
  }, [items, q, now, outbox.length, pendingState]);

  const grabId =
    columns.ready.find((i) => i.battery.status === "active" && restRemaining(i, now) === 0)?.battery.id ?? columns.ready[0]?.battery.id;

  function doBrownout(id: string) {
    setBusyId(id);
    start(async () => {
      const fd = new FormData();
      fd.set("kind", "brownout");
      fd.set("notes", "Brownout (one-tap)");
      if (matchLabel) fd.set("match_label", matchLabel);
      await run("logIncident", id, fd);
      setBusyId(null);
    });
  }

  /** Right-click a battery: jump to what you'd do next without opening the sheet first. */
  function batteryMenu(item: BatteryWithHealth, e: React.MouseEvent<HTMLElement>) {
    const b = item.battery;
    const quickMove = (to: BatteryState) => {
      // Charging → Ready asks for a resting voltage, so that one goes through the sheet.
      if (b.state === "charging" && to === "ready") return actions.open(b, "move");
      setBusyId(b.id);
      start(async () => {
        const fd = new FormData();
        fd.set("to", to);
        await run("moveStateForm", b.id, fd);
        setBusyId(null);
      });
    };
    const entries: MenuEntry[] = [
      { label: "Open battery", icon: "→", onSelect: () => router.push(`/battery/batteries/${encodeURIComponent(b.name)}`) },
      { label: "Open in new tab", icon: "↗", onSelect: () => window.open(`/battery/batteries/${encodeURIComponent(b.name)}`, "_blank", "noopener") },
      "separator",
      { label: "Quick actions…", icon: "⚡", onSelect: () => actions.open(b) },
      b.state === "ready" && { label: "Pre-match check", icon: "▶", onSelect: () => actions.open(b, "pre") },
      b.state === "in_robot" && { label: "Post-match check", icon: "■", onSelect: () => actions.open(b, "post") },
      { label: "Log charge", icon: "⚡", onSelect: () => actions.open(b, "charge") },
      { label: "Beak check", icon: "◎", onSelect: () => actions.open(b, "beak") },
      {
        label: "Move to", icon: "⇄",
        children: STATES.map((s) => ({ label: STATE_LABEL[s], checked: s === b.state, disabled: s === b.state, onSelect: () => quickMove(s) })),
      },
      "separator",
      { label: "Flag issue", icon: "⚑", danger: true, onSelect: () => actions.open(b, "incident") },
      { label: "Add note", icon: "✎", onSelect: () => actions.open(b, "note") },
      { label: "Copy name", icon: "⧉", onSelect: async () => menu.toast((await copyText(b.name)) ? "Name copied" : "Couldn't copy") },
    ];
    menu.show(e, entries, b.name);
  }

  const queuedIds = useMemo(() => new Set(outbox.map((e) => e.batteryId)), [outbox]);

  if (items.length === 0) {
    return (
      <Empty>
        No batteries yet.{" "}
        <Link href="/battery/batteries/new" className="underline" style={{ color: "var(--purple)" }}>
          Add the first one →
        </Link>
      </Empty>
    );
  }

  const grab = columns.ready.find((i) => i.battery.id === grabId);
  const grabRest = grab ? restRemaining(grab, now) : 0;
  const grabTested = grab ? (grab.health.latestBeak?.at ?? grab.health.latestCba?.at ?? null) : null;

  return (
    <>
      {/* The one decision people come here for: which battery to take. */}
      {grab ? (
        <section
          className="card mb-5 p-5 sm:p-6 flex flex-wrap items-center gap-x-6 gap-y-4"
          style={{ borderColor: "var(--purple)", boxShadow: "inset 0 0 0 1px var(--purple), var(--shadow-md)" }}
          aria-labelledby="grab-name"
        >
          <div className="min-w-0 flex-[1_1_320px] flex flex-col gap-2">
            <span className="pill pill-purple self-start">★ Grab this one</span>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="grab-name" className="display text-4xl">{grab.battery.name}</h2>
              {grab.health.lastVoltage && <span className="text-xl font-semibold tabular-nums">{fmtNum(grab.health.lastVoltage.v, 2)} V</span>}
              <HealthPill badge={grab.health.badge} score={grab.health.score} />
            </div>
            <p className="text-[15px]" style={{ color: "var(--muted)" }}>
              {grabRest > 0 ? `Still resting — ready in ${grabRest} min. ` : "Healthiest ready battery that's done resting. "}
              {grab.battery.cycle_count} cycles · {grabTested ? `tested ${timeAgo(grabTested, now)}` : "not tested yet"}
              {grab.battery.status === "practice_only" ? " · practice only" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary text-base px-6 min-h-[52px]" onClick={() => actions.open(grab.battery, compMode ? "pre" : undefined)}>
              {compMode ? "Pre-match check" : "Use this battery"} <span aria-hidden>→</span>
            </button>
          </div>
        </section>
      ) : (
        <div className="card mb-5 p-5 text-[15px]" style={{ color: "var(--muted)" }}>
          No battery is ready right now. Check <b style={{ color: "var(--ink)" }}>Charging</b> for the next one.
        </div>
      )}

      {/* Mobile state tabs */}
      <div
        className="md:hidden sticky top-[var(--app-header-height,56px)] z-20 -mx-4 px-4 py-2 mb-2 border-b"
        style={{ background: "var(--paper)", borderColor: "var(--line)" }}
        role="tablist"
        aria-label="Battery state"
      >
        <div className="battery-state-tabs grid grid-cols-2 gap-2">
          {STATES.map((state) => {
            const active = tab === state;
            const n = columns[state].length;
            return (
              <button
                key={state}
                type="button"
                role="tab"
                aria-selected={active}
                className="tile tile-chip flex items-center gap-2 text-sm justify-center"
                data-selected={active}
                onClick={() => setTab(state)}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: `var(--${STATE_TONE[state]})` }} />
                <span className="font-medium">{STATE_LABEL[state]}</span>
                <span
                  className="mono text-xs font-semibold"
                  style={{
                    color: active ? "var(--purple-dark)" : "var(--muted)",
                  }}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {STATES.map((state) => {
          const list = columns[state];
          return (
            <section key={state} className={`min-w-0 ${tab === state ? "" : "hidden md:block"}`}>
              <header className="hidden md:flex items-center justify-between mb-2 px-0.5">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: `var(--${STATE_TONE[state]})` }} />
                  {STATE_LABEL[state]}
                </h2>
                <span className="text-sm font-semibold" style={{ color: "var(--muted)" }}>
                  {list.length}
                </span>
              </header>
              <div className="flex flex-col gap-2">
                {list.length === 0 && (
                  <div
                    className="rounded-[10px] border border-dashed p-6 md:p-4 text-center text-sm md:text-xs"
                    style={{
                      borderColor: "var(--line)",
                      color: "var(--muted)",
                    }}
                  >
                    {state === "ready" ? "Nothing ready" : `Nothing ${STATE_LABEL[state].toLowerCase()}`}
                  </div>
                )}
                {list.map((item) => (
                  <BatteryCard
                    key={item.battery.id}
                    item={item}
                    now={now}
                    grab={state === "ready" && item.battery.id === grabId}
                    onClick={() => actions.open(item.battery)}
                    onContextMenu={(e) => batteryMenu(item, e)}
                    queued={queuedIds.has(item.battery.id)}
                    extra={
                      compMode && state === "in_robot" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            className="btn btn-primary text-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              actions.open(item.battery, "post");
                            }}
                          >
                            Post-match
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger text-sm"
                            disabled={pending && busyId === item.battery.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              doBrownout(item.battery.id);
                            }}
                          >
                            {busyId === item.battery.id ? (
                              "Logging…"
                            ) : (
                              <>
                                <BoltIcon /> Brownout
                              </>
                            )}
                          </button>
                        </div>
                      ) : compMode && state === "ready" && item.battery.id === grabId ? (
                        <button
                          type="button"
                          className="btn btn-primary w-full text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.open(item.battery, "pre");
                          }}
                        >
                          Pre-match check <span aria-hidden>→</span>
                        </button>
                      ) : null
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
        Ready is sorted best-first (health, then longest rested). Rest window {settings.min_rest_after_charge_min}m after charge.
      </p>
      <BatteryActionSheet
        battery={actions.battery}
        view={actions.view}
        onClose={actions.close}
        onView={actions.setView}
        settings={settings}
      />
    </>
  );
}
