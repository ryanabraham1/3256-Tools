"use client";
import { createContext, useContext, type MouseEvent } from "react";
import { copyText, useContextMenu, type MenuEntry } from "../context-menu";
import { issueCode, KIND_NAMES, uniqueStatuses, type WorkData, type WorkItem, type WorkKind } from "@/lib/work";

export function itemRoute(item: WorkItem) {
  return `/work/${({ issue: "issues", project: "projects", milestone: "projects", initiative: "initiatives", document: "documents", view: "views" } as Record<string, string>)[item.kind] ?? "settings"}/${item.id}`;
}

export type ItemActions = {
  /** Member id of the signed-in user, used for favorites. */
  actor?: string;
  disabled?: boolean;
  onOpen: (item: WorkItem) => void;
  onEdit: (item: WorkItem) => void;
  onPatch: (item: WorkItem, data: WorkData) => void;
  onArchive: (item: WorkItem) => void;
  onRestore: (item: WorkItem) => void;
  onTrash: (item: WorkItem) => void;
  onCreate: (kind: WorkKind, preset?: WorkData) => void;
};

const HEALTH = ["On track", "At risk", "Off track"];
const PLAN_STATUSES = ["Planned", "In progress", "Done", "Canceled"];
/** Kinds people delete from Settings; the rest are archived instead. */
const DELETABLE = ["label", "template", "milestone", "document", "view", "project", "initiative", "issue"];

/**
 * Right-click menu for any Work item that is not a task or milestone (those have their own richer menus):
 * projects, initiatives, documents, saved views, and the settings rows (labels, members, teams, templates…).
 * Also handles items sitting in Archive & trash, where the useful action is Restore.
 */
export function useItemMenu(items: WorkItem[], a: ItemActions) {
  const menu = useContextMenu();
  const readOnly = !!a.disabled;

  function entries(stale: WorkItem): MenuEntry[] {
    // Read the live row so optimistic edits are reflected and stale clicks don't act on old data.
    const item = items.find(i => i.id === stale.id) ?? stale;
    const name = KIND_NAMES[item.kind].toLowerCase();
    const copy = async (text: string, what: string) => menu.toast((await copyText(text)) ? `${what} copied` : "Couldn't copy");
    const link = () => `${window.location.origin}${itemRoute(item)}`;

    if (item.deleted_at || item.archived) {
      return [
        { label: `Restore ${name}`, icon: "↩", disabled: readOnly, onSelect: () => a.onRestore(item) },
        "separator",
        { label: "Copy title", icon: "⧉", onSelect: () => copy(item.title, "Title") },
      ];
    }

    const favorite = !!a.actor && !!item.data.favorites?.includes(a.actor);
    const members = items.filter(i => i.kind === "member" && !i.archived && !i.deleted_at);
    const planned = ["project", "initiative"].includes(item.kind);
    const out: MenuEntry[] = [
      item.kind === "view" ? { label: "Apply view", icon: "→", onSelect: () => a.onOpen(item) } : { label: `Open ${name}`, icon: "→", onSelect: () => a.onOpen(item) },
      { label: "Open in new tab", icon: "↗", onSelect: () => window.open(itemRoute(item), "_blank", "noopener") },
      { label: "Edit…", icon: "✎", disabled: readOnly, onSelect: () => a.onEdit(item) },
    ];

    if (planned) {
      const status = item.data.status ?? "Planned";
      out.push(
        "separator",
        {
          label: "Status", icon: "◐",
          children: uniqueStatuses([status, ...PLAN_STATUSES]).map(s => ({
            label: s, checked: s === status, disabled: readOnly, onSelect: () => a.onPatch(item, { status: s }),
          })),
        },
        {
          label: "Health", icon: "♥",
          children: HEALTH.map(h => ({
            label: h, checked: h === (item.data.health ?? "On track"), disabled: readOnly, onSelect: () => a.onPatch(item, { health: h }),
          })),
        },
        {
          label: "Lead", icon: "☺",
          children: [{ id: "", title: "No lead" }, ...members].map(m => ({
            label: m.title, checked: m.id === (item.data.assignee ?? ""), disabled: readOnly, onSelect: () => a.onPatch(item, { assignee: m.id }),
          })),
        },
        item.kind === "project"
          ? { label: "New task in project", icon: "+", disabled: readOnly, onSelect: () => a.onCreate("issue", { project: item.id }) }
          : { label: "New project in initiative", icon: "+", disabled: readOnly, onSelect: () => a.onCreate("project", { initiative: item.id }) },
      );
    }

    out.push("separator");
    if (a.actor) {
      out.push({
        label: favorite ? "Remove from favorites" : "Add to favorites", icon: favorite ? "★" : "☆", disabled: readOnly,
        onSelect: () => a.onPatch(item, { favorites: favorite ? (item.data.favorites ?? []).filter(v => v !== a.actor) : [...(item.data.favorites ?? []), a.actor!] }),
      });
    }
    out.push(
      { label: "Copy link", icon: "⧉", onSelect: () => copy(link(), "Link") },
      { label: "Copy title", icon: "⧉", onSelect: () => copy(item.title, "Title") },
    );
    if (item.kind === "issue") out.push({ label: "Copy ID", icon: "⧉", onSelect: () => copy(issueCode(item, items), "ID") });

    const canArchive = ["project", "initiative", "document", "view"].includes(item.kind);
    if (canArchive || DELETABLE.includes(item.kind)) out.push("separator");
    if (canArchive) out.push({ label: "Archive", icon: "▣", disabled: readOnly, onSelect: () => a.onArchive(item) });
    if (DELETABLE.includes(item.kind)) out.push({ label: `Delete ${name}`, icon: "🗑", danger: true, disabled: readOnly, onSelect: () => a.onTrash(item) });
    return out;
  }

  return {
    show: (item: WorkItem, e: MouseEvent<HTMLElement>) => menu.show(e, entries(item), item.title),
    entries,
  };
}

/** Right-click on the empty page: quick ways to start new things and move around. */
export function usePageMenu(opts: {
  disabled?: boolean;
  onCreate: (kind: WorkKind) => void;
  onSearch: () => void;
  onHelp: () => void;
  onNavigate: (path: string) => void;
  onExport?: () => void;
  extra?: MenuEntry[];
}) {
  const menu = useContextMenu();
  return (e: MouseEvent<HTMLElement>) => {
    // Rows and controls claim their own right-click; only the bare page gets this menu.
    const t = e.target as Element;
    if (t.closest("a, button, input, textarea, select, [role=button], [role=menuitem], [contenteditable], dialog, .work-card, .work-project-card, .work-context-menu")) return;
    menu.show(e, [
      { label: "New task", icon: "+", hint: "C", disabled: opts.disabled, onSelect: () => opts.onCreate("issue") },
      { label: "New project", icon: "+", disabled: opts.disabled, onSelect: () => opts.onCreate("project") },
      { label: "New initiative", icon: "+", disabled: opts.disabled, onSelect: () => opts.onCreate("initiative") },
      { label: "New document", icon: "+", disabled: opts.disabled, onSelect: () => opts.onCreate("document") },
      ...(opts.extra?.length ? (["separator", ...opts.extra] as MenuEntry[]) : []),
      "separator",
      { label: "Search…", icon: "⌕", hint: "⌘K", onSelect: opts.onSearch },
      {
        label: "Go to", icon: "☰",
        children: [
          ["home", "Home"], ["my-issues", "My work"], ["inbox", "Notifications"], ["issues", "Tasks"], ["projects", "Projects"],
          ["initiatives", "Initiatives"], ["updates", "Team"], ["views", "Saved views"], ["archive", "Archive & trash"], ["settings", "Settings"],
        ].map(([path, label]) => ({ label, onSelect: () => opts.onNavigate(path) })),
      },
      opts.onExport && { label: "Export workspace", icon: "⇩", onSelect: opts.onExport },
      { label: "Help & shortcuts", icon: "?", hint: "?", onSelect: opts.onHelp },
    ], "Work");
  };
}

type ShowItem = (item: WorkItem, e: MouseEvent<HTMLElement>) => void;
const ShowItemContext = createContext<ShowItem | null>(null);
export const ItemMenuProvider = ShowItemContext.Provider;
/**
 * Returns a right-click handler factory for any Work item (task, milestone, project, document…) from anywhere under the workspace.
 * Usage: `const menu = useItemMenuShow(); <button onContextMenu={menu(item)} />`. Outside the workspace it does nothing,
 * so the page-level menu still appears.
 */
export function useItemMenuShow() {
  const show = useContext(ShowItemContext);
  return (item: WorkItem) => (e: MouseEvent<HTMLElement>) => show?.(item, e);
}
