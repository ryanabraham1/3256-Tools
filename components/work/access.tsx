"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeWorkAccess, setWorkAccess } from "@/app/work-actions";
import type { WorkAccess, WorkRole } from "@/lib/work-auth";

const ROLE_ORDER: Record<WorkRole, number> = { admin: 0, member: 1, viewer: 2 };
// Compact controls: the global .input/.btn are 44px tall for touch, which
// makes a long people list scroll forever on desktop. Keep 44px on phones.
const control = "h-11 sm:h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[16px] sm:text-sm";
const smallBtn = "h-11 sm:h-8 px-2.5 rounded-md text-sm font-medium border border-transparent hover:border-[var(--line)] disabled:opacity-50 disabled:cursor-not-allowed";

export function AccessPanel({
  accounts,
  currentEmail,
}: {
  accounts: WorkAccess[];
  currentEmail: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkRole>("member");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState("");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const me = currentEmail.toLowerCase();

  const counts = useMemo(() => {
    const c = { admin: 0, member: 0, viewer: 0, pending: 0, disabled: 0 };
    for (const a of accounts) {
      c[a.role]++;
      if (a.disabled) c.disabled++;
      else if (!a.user_id) c.pending++;
    }
    return c;
  }, [accounts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((a) => !q || a.email.toLowerCase().includes(q))
      .sort((a, b) =>
        Number(a.disabled) - Number(b.disabled) ||
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        a.email.localeCompare(b.email),
      );
  }, [accounts, query]);

  function save(email: string, role: WorkRole, disabled = false) {
    startTransition(async () => {
      setError("");
      const result = await setWorkAccess(email, role, disabled);
      if (!result.ok) setError(result.error || "Couldn't save access.");
      else {
        setEmail("");
        router.refresh();
      }
    });
  }
  function remove(email: string) {
    startTransition(async () => {
      setError("");
      const result = await removeWorkAccess(email);
      setConfirming("");
      if (!result.ok) setError(result.error || "Couldn't remove access.");
      else router.refresh();
    });
  }

  return (
    <div>
      <form
        className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-3 border-b border-[var(--line)]"
        onSubmit={(e) => {
          e.preventDefault();
          save(email, role);
        }}
      >
        <input
          className={`${control} grow min-w-0 basis-full sm:basis-auto`}
          type="email"
          required
          aria-label="Google account email"
          placeholder="Add a Google account email…"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className={`${control} grow sm:grow-0`}
          aria-label="Role for new person"
          value={role}
          onChange={(e) => setRole(e.target.value as WorkRole)}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
        <button
          className="h-11 sm:h-8 px-3 rounded-md text-sm font-semibold bg-[var(--purple)] text-white disabled:opacity-50 shrink-0"
          disabled={pending}
        >
          Add
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b border-[var(--line)] text-xs text-[var(--muted)]">
        <span>
          {accounts.length} people · {counts.admin} admin · {counts.member} member · {counts.viewer} viewer
          {counts.pending > 0 && ` · ${counts.pending} not signed in`}
          {counts.disabled > 0 && ` · ${counts.disabled} disabled`}
        </span>
        {accounts.length > 8 && (
          <input
            className={`${control} ml-auto w-full sm:w-56`}
            type="search"
            aria-label="Filter people"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {error && (
        <p className="text-sm text-[var(--bad)] px-3 py-2 border-b border-[var(--line)]" role="alert">
          {error}
        </p>
      )}

      <ul>
        {shown.map((a) => {
          const self = a.email.toLowerCase() === me;
          const status = a.disabled ? "Disabled" : a.user_id ? null : "Invited";
          return (
            <li
              key={a.email}
              className={`flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1.5 px-3 py-2 sm:py-1.5 border-b border-[var(--line)] last:border-b-0 hover:bg-[color-mix(in_srgb,var(--line)_30%,transparent)] ${a.disabled ? "opacity-60" : ""}`}
            >
              <div className="min-w-0 flex-1 basis-full sm:basis-auto flex items-center gap-2">
                <span className="text-sm truncate" title={a.email}>{a.email}</span>
                {self && <span className="text-xs text-[var(--muted)] shrink-0">(you)</span>}
                {status && (
                  <span className="text-[11px] leading-none px-1.5 py-1 rounded border border-[var(--line)] text-[var(--muted)] shrink-0">
                    {status}
                  </span>
                )}
              </div>
              <select
                className={`${control} w-28`}
                aria-label={`Role for ${a.email}`}
                value={a.role}
                disabled={pending || self}
                onChange={(e) => save(a.email, e.target.value as WorkRole, a.disabled)}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              {confirming === a.email ? (
                <>
                  <button className={smallBtn} disabled={pending} onClick={() => setConfirming("")}>
                    Cancel
                  </button>
                  <button
                    className={`${smallBtn} bg-[var(--bad)] text-white`}
                    disabled={pending}
                    onClick={() => remove(a.email)}
                  >
                    {pending ? "Removing…" : "Remove"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={`${smallBtn} w-[4.75rem]`}
                    disabled={pending || self}
                    onClick={() => save(a.email, a.role, !a.disabled)}
                  >
                    {a.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    className={`${smallBtn} text-[var(--bad)]`}
                    disabled={pending || self}
                    onClick={() => setConfirming(a.email)}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-3 py-4 text-sm text-[var(--muted)]">No one matches “{query}”.</li>
        )}
      </ul>
    </div>
  );
}
