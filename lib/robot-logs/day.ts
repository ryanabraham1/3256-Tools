/** One heading per calendar day: "Today · Nov 11", "Monday · Nov 9", "November 3", "March 2, 2025". */
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  const short = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (days === 0) return `Today · ${short}`;
  if (days === 1) return `Yesterday · ${short}`;
  if (days > 1 && days < 7) return `${date.toLocaleDateString(undefined, { weekday: "long" })} · ${short}`;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
