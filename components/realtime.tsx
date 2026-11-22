"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { pageShowsTable } from "@/lib/refresh-scope";

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
    const refresh = (delay = 250) => {
      if (document.visibilityState === "hidden") {
        missed = true;
        return;
      }
      readAt = Date.now();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        pendingAt.current = null;
        // A refresh with no network just errors; the offline poller refreshes on reconnect.
        if (navigator.onLine) router.refresh();
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
        live = status === "SUBSCRIBED";
      });

    // Coming back refreshes once if a ping arrived meanwhile or the page is over a minute old.
    const back = () => {
      if (document.visibilityState !== "visible" || (!missed && Date.now() - readAt < 60_000)) return;
      missed = false;
      refresh();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    // Every minute without live pings; every 5 minutes as a backstop with them.
    const interval = setInterval(() => {
      if (!live || Date.now() - readAt >= 5 * 60_000) refresh();
    }, 60_000);

    return () => {
      if (channel) sb?.removeChannel(channel);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      clearInterval(interval);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  return null;
}
