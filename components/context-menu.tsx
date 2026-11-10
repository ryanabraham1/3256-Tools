"use client";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

/** One row of a right-click menu. `children` opens a drill-down panel; `keepOpen` leaves the menu up after choosing. */
export type MenuItem = {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Shows a check (and works as a radio / checkbox row). */
  checked?: boolean;
  keepOpen?: boolean;
  onSelect?: () => void;
  children?: MenuEntry[];
};
export type MenuEntry = MenuItem | "separator" | false | null | undefined;

type Open = { x: number; y: number; title?: string; stack: { title?: string; entries: MenuItem[] | MenuEntry[] }[] };
type Api = {
  /** Open a menu at the pointer. Call from `onContextMenu`; it cancels the browser menu and stops the page-level fallback. */
  show: (e: ReactMouseEvent | MouseEvent, entries: MenuEntry[], title?: string) => void;
  /** Open a menu under an element (for a ⋯ button or keyboard). */
  showBelow: (anchor: Element | null, entries: MenuEntry[], title?: string) => void;
  toast: (message: string) => void;
};

const Ctx = createContext<Api | null>(null);

export function useContextMenu(): Api {
  const api = useContext(Ctx);
  // Outside the provider (tests, isolated renders) fall back to the browser's own menu.
  return api ?? { show: () => {}, showBelow: () => {}, toast: () => {} };
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** The page-level menu: what a right-click does anywhere nothing more specific claimed it. */
function usePageEntries() {
  const router = useRouter();
  return useCallback((target: Element | null, toast: (m: string) => void): MenuEntry[] => {
    const entries: MenuEntry[] = [];
    const selection = window.getSelection()?.toString().trim();
    const link = target?.closest<HTMLAnchorElement>("a[href]");
    const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied` : "Couldn't copy");
    if (selection) {
      entries.push({ label: "Copy", icon: "⧉", hint: "⌘C", onSelect: () => copy(selection, "Text") }, "separator");
    }
    if (link) {
      const href = link.getAttribute("href") ?? "";
      const internal = href.startsWith("/") && !href.startsWith("//");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        entries.push(
          { label: "Open link", icon: "→", onSelect: () => (internal ? router.push(href) : window.open(link.href, "_blank", "noopener")) },
          { label: "Open in new tab", icon: "↗", onSelect: () => window.open(link.href, "_blank", "noopener") },
          { label: "Copy link address", icon: "⧉", onSelect: () => copy(link.href, "Link") },
          "separator",
        );
      }
    }
    entries.push(
      { label: "Back", icon: "←", onSelect: () => window.history.back() },
      { label: "Forward", icon: "→", onSelect: () => window.history.forward() },
      { label: "Reload", icon: "↻", onSelect: () => router.refresh() },
      "separator",
      {
        label: "Go to",
        icon: "☰",
        children: [
          { label: "Battery board", onSelect: () => router.push("/battery") },
          { label: "Parts tracker", onSelect: () => router.push("/tracker") },
          { label: "Stock", onSelect: () => router.push("/stock") },
          { label: "Work", onSelect: () => router.push("/work") },
        ],
      },
      { label: "Copy page link", icon: "⧉", onSelect: () => copy(window.location.href, "Page link") },
      { label: "Print", icon: "⎙", onSelect: () => window.print() },
      { label: "Hold ⇧ for browser menu", disabled: true },
    );
    return entries;
  }, [router]);
}

const clean = (entries: MenuEntry[]): MenuItem[] => {
  // Drop empty slots and collapse leading / trailing / doubled separators.
  const out: (MenuItem | "separator")[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === "separator") {
      if (out.length && out[out.length - 1] !== "separator") out.push(e);
    } else out.push(e);
  }
  while (out[out.length - 1] === "separator") out.pop();
  return out as unknown as MenuItem[];
};

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<Open | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const pageEntries = usePageEntries();

  const toast = useCallback((m: string) => setToastMsg(m), []);
  useEffect(() => {
    if (!toastMsg) return;
    const id = setTimeout(() => setToastMsg(""), 2200);
    return () => clearTimeout(id);
  }, [toastMsg]);

  const api = useMemo<Api>(() => ({
    show: (e, entries, title) => {
      e.preventDefault();
      e.stopPropagation();
      const list = clean(entries);
      if (list.length) setMenu({ x: e.clientX, y: e.clientY, title, stack: [{ title, entries: list }] });
    },
    showBelow: (anchor, entries, title) => {
      const r = anchor?.getBoundingClientRect();
      const list = clean(entries);
      if (list.length) setMenu({ x: r ? r.left : window.innerWidth / 3, y: r ? r.bottom + 4 : window.innerHeight / 3, title, stack: [{ title, entries: list }] });
    },
    toast,
  }), [toast]);

  // Page-level fallback for every right-click nothing else claimed.
  useEffect(() => {
    function onContext(e: MouseEvent) {
      if (e.defaultPrevented || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      // Keep the native menu where it already does the right thing (spell-check, paste, select all).
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], video, audio, canvas")) return;
      if (target?.closest(".ctx-menu")) { e.preventDefault(); return; }
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, stack: [{ entries: clean(pageEntries(target, toast)) }] });
    }
    document.addEventListener("contextmenu", onContext);
    return () => document.removeEventListener("contextmenu", onContext);
  }, [pageEntries, toast]);

  // Dismiss on outside click, scroll, resize, Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".ctx-menu")) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);

  const panel = menu?.stack[menu.stack.length - 1];
  const depth = menu?.stack.length ?? 0;

  // Keep the menu on screen, and move focus in whenever the panel changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu, depth]);

  function choose(item: MenuItem) {
    if (item.disabled) return;
    if (item.children) {
      setMenu(m => m && { ...m, stack: [...m.stack, { title: item.label, entries: clean(item.children!) }] });
      return;
    }
    if (!item.keepOpen) setMenu(null);
    item.onSelect?.();
  }

  const entries = (panel?.entries ?? []) as (MenuItem | "separator")[];
  return (
    <Ctx.Provider value={api}>
      {children}
      {menu && panel && (
        <div
          ref={ref}
          className="ctx-menu"
          role="menu"
          aria-label={panel.title || menu.title || "Actions"}
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={e => e.preventDefault()}
          onKeyDown={e => {
            const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              buttons[(i + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
            } else if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
            } else if ((e.key === "ArrowLeft" || e.key === "Backspace") && depth > 1) {
              e.preventDefault();
              setMenu(m => m && { ...m, stack: m.stack.slice(0, -1) });
            }
          }}
        >
          {depth > 1 && <>
            <button role="menuitem" onClick={() => setMenu(m => m && { ...m, stack: m.stack.slice(0, -1) })}><span className="ctx-icon" aria-hidden>←</span>{panel.title || "Back"}</button>
            <hr />
          </>}
          {depth === 1 && menu.title && <p className="ctx-title">{menu.title}</p>}
          {entries.map((item, n) => item === "separator"
            ? <hr key={n} />
            : <button
                key={n}
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                className={item.danger ? "danger" : undefined}
                disabled={item.disabled}
                onClick={() => choose(item)}
              >
                <span className="ctx-icon" aria-hidden>{item.icon}</span>
                <span className="ctx-label">{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
                {item.checked && <span className="ctx-check" aria-hidden>✓</span>}
                {item.children && <span className="ctx-check" aria-hidden>›</span>}
              </button>)}
        </div>
      )}
      {toastMsg && <div className="ctx-toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}
