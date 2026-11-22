/**
 * Which database "changed" pings a page re-reads for. Each re-read pulls the whole page from
 * Supabase (billed egress), so a page only refreshes for tables it shows. Pages not listed here
 * (home, admin, logs) refresh for everything except Work, which only the home page shows.
 */
const SECTIONS: [prefix: string, shows: (table: string) => boolean][] = [
  ["/battery", (t) => t === "batteries" || t === "battery_events" || t === "settings"],
  ["/stock", (t) => t.startsWith("fab_")],
  ["/tracker", (t) => t.startsWith("fab_")],
  ["/pit", (t) => t.startsWith("pit_")],
];

export function pageShowsTable(path: string, table: string | undefined): boolean {
  if (!table) return true;
  const section = SECTIONS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (section) return section[1](table);
  if (table.startsWith("work_")) return path === "/" || path.startsWith("/work-preview");
  return true;
}
