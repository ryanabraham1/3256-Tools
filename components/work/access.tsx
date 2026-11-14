"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeWorkAccess, setWorkAccess } from "@/app/work-actions";
import type { WorkAccess, WorkRole } from "@/lib/work-auth";
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
  const [pending, startTransition] = useTransition();
  const router = useRouter();
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
    <div className="work-access">
      <h2 className="text-lg font-semibold mb-4">People</h2>
      <form
        className="flex flex-wrap items-end gap-3 mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          save(email, role);
        }}
      >
        <label className="flex flex-col gap-1.5 grow min-w-0">
          <span className="label">Google account email</span>
          <input
            className="input"
            type="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Role</span>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as WorkRole)}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <button className="btn btn-primary" disabled={pending}>
          Add access
        </button>
      </form>
      <p className="text-sm text-[var(--muted)]">
        Admins manage access and teams. Members edit team tools. Viewers can read.
        Added people sign in with their own Google account.
      </p>
      {error && (
        <p className="text-sm text-[var(--bad)] my-4" role="alert">
          {error}
        </p>
      )}
      <div className="mt-5">
        {accounts.map((a) => (
          <div key={a.email} className="flex flex-wrap items-center gap-3 py-4 border-b border-[var(--line)]">
            <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              <b className="text-sm font-medium break-all">{a.email}</b>
              <span className="block text-sm mt-1 text-[var(--muted)]">
                {a.disabled
                  ? "Disabled"
                  : a.user_id
                    ? "Joined"
                    : "Not signed in yet"}
              </span>
            </div>
            <select
              className="input text-sm"
              aria-label={`Role for ${a.email}`}
              value={a.role}
              disabled={pending || a.email.toLowerCase() === currentEmail.toLowerCase()}
              onChange={(e) =>
                save(a.email, e.target.value as WorkRole, a.disabled)
              }
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              className="btn btn-ghost text-sm"
              disabled={pending || a.email.toLowerCase() === currentEmail.toLowerCase()}
              onClick={() => save(a.email, a.role, !a.disabled)}
            >
              {a.disabled ? "Enable" : "Disable"}
            </button>
            {confirming === a.email ? (
              <>
                <button
                  className="btn btn-ghost text-sm"
                  disabled={pending}
                  onClick={() => setConfirming("")}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger text-sm"
                  disabled={pending}
                  onClick={() => remove(a.email)}
                >
                  {pending ? "Removing…" : "Confirm remove"}
                </button>
              </>
            ) : (
              <button
                className="btn btn-ghost text-sm text-[var(--bad)]"
                disabled={pending || a.email.toLowerCase() === currentEmail.toLowerCase()}
                onClick={() => setConfirming(a.email)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
