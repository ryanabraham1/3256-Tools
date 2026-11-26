"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { pageShowsTable } from "@/lib/refresh-scope";

const FALLBACK_REFRESH_MS = 60_000;
const LIVE_REFRESH_MS = 15 * FALLBACK_REFRESH_MS;

/**
 * Keeps every phone in the pit in sync: refreshes server data when the DB
 * broadcasts a change, when the tab comes back, and on a slow fallback timer.
 *
 * Every refresh re-reads the page from Supabase, which bills each byte it sends, so:
 * - a tab in the background never refreshes (it catches up once when it's looked at again);
 * - a page only refreshes for pings from tables it shows (lib/refresh-scope.ts);
 * - a ping waits a moment, and is dropped if a page render that started after the change
 *   arrives meanwhile (your own edit's re-render already has it);
 * - the fallback timer is slow while the live pings are connected.
 *
 * `renderedAt` is the server's clock when the (app) layout last rendered, which happens on a
 * refresh or after a server action, not on navigation.
 */
export function Realtime({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const path = usePathname();
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRender = useRef(Date.parse(renderedAt));
  // The change a scheduled refresh is for; a newer render makes it unnecessary.
  const pendingAt = useRef<number | null>(null);
  useEffect(() => {
    lastRender.current = Date.parse(renderedAt);
    if (pendingAt.current !== null && lastRender.current >= pendingAt.current) {
      if (timer.current) clearTimeout(timer.current);
      pendingAt.current = null;
    }
  }, [renderedAt]);

  useEffect(() => {
    let missed = false;
    let readAt = Date.now();
    let live = false;
    let wasConnected = false;
    const refreshInterval = () => live ? LIVE_REFRESH_MS : FALLBACK_REFRESH_MS;
    const refresh = (delay = 250) => {
      if (document.visibilityState === "hidden") {
        missed = true;
        return;
      }
      const scheduledAt = Date.now();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (document.visibilityState === "hidden" || !navigator.onLine) {
          missed = true;
          return;
        }
        missed = false;
        readAt = scheduledAt;
        pendingAt.current = null;
        router.refresh();
      }, delay);
    };

    const sb = supabaseBrowser();
    const channel = sb
      ?.channel("board")
      .on("broadcast", { event: "changed" }, (message) => {
        const { table, at } = (message.payload ?? {}) as { table?: string; at?: string };
        if (!pageShowsTable(pathRef.current, table)) return;
        const changedAt = at ? Date.parse(at) : NaN;
        if (Number.isFinite(changedAt)) {
          // Already showing a render that started after this change.
          if (lastRender.current >= changedAt) return;
          pendingAt.current = Math.max(pendingAt.current ?? 0, changedAt);
        } else pendingAt.current = Infinity;
        refresh(1500);
      })
      .subscribe((status) => {
        const connected = status === "SUBSCRIBED";
        const reconnected = connected && !live && wasConnected;
        live = connected;
        wasConnected ||= connected;
        if (reconnected) refresh();
      });

    // Coming back refreshes once for missed changes or a due fallback read.
    const back = () => {
      if (document.visibilityState !== "visible" || (!missed && Date.now() - readAt < refreshInterval())) return;
      refresh();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    window.addEventListener("online", back);
    // Every minute without live pings; every 15 minutes as a backstop with them.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && (!live || Date.now() - readAt >= LIVE_REFRESH_MS)) refresh();
    }, FALLBACK_REFRESH_MS);

    return () => {
      if (channel) sb?.removeChannel(channel);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      window.removeEventListener("online", back);
      clearInterval(interval);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  return null;
}
