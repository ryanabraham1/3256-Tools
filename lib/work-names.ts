/**
 * Member display names. Many member rows were created with the person's email
 * as their name (Linear import, or Google gave no name). These helpers decide
 * when a name is just a placeholder we may replace, and what to replace it with.
 */

/** "first.last@school.net" → "First Last". Null when the address isn't shaped like a name. */
export function nameFromEmail(email: string): string | null {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._]/).filter(Boolean);
  if (parts.length < 2 || parts.some((p) => !/^[a-z]+$/i.test(p))) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

/** True when the member name is an email or our email-derived guess, i.e. nobody chose it. */
export function isPlaceholderName(title: string, email: string): boolean {
  const t = title.trim();
  if (!t || t.includes("@")) return true;
  const lower = t.toLowerCase();
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return lower === local || lower === nameFromEmail(email)?.toLowerCase();
}

/** Best name for an account: the Google profile name, else one read from the email, else the email. */
export function bestName(email: string, googleName?: string | null): string {
  return (googleName ?? "").trim() || nameFromEmail(email) || email;
}
