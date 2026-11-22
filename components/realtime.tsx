"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

/** Only the home page shows Work; everywhere else a Work edit is no reason to re-read the page. */
const showsWork = (path: string) => path === "/" || path.startsWith("/work-preview");

/**
 * Keeps every phone in the pit in sync: refreshes server data when the DB
 * broadcasts a change, when the tab comes back, and on a slow fallback timer.
 *
 * Every refresh re-reads the page from Supabase, which bills each byte it sends, so a tab in
 * the background never refreshes (it catches up once when it's looked at again), and the
 * fallback timer is slow while the live "changed" pings are connected.
 */
export function Realtime() {
  const router = useRouter();
  const path = usePathname();
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let missed = false;
    let readAt = Date.now();
    let live = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        missed = true;
        return;
      }
      readAt = Date.now();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // A refresh with no network just errors; the offline poller refreshes on reconnect.
        if (navigator.onLine) router.refresh();
      }, 250);
    };

    const sb = supabaseBrowser();
    const channel = sb
      ?.channel("board")
      .on("broadcast", { event: "changed" }, (message) => {
        const table = (message.payload as { table?: string } | undefined)?.table;
        if (table?.startsWith("work_") && !showsWork(pathRef.current)) return;
        refresh();
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
