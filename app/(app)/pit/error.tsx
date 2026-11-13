"use client";

export default function PitError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card p-6 max-w-lg mx-auto mt-10 flex flex-col gap-3">
      <p className="eyebrow" style={{ color: "var(--bad)" }}>
        Something broke
      </p>
      <h1 className="display text-3xl">Couldn&apos;t load the pit checklist.</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        After an update, the database may need the newest file in <code className="mono">supabase/migrations/</code> (currently{" "}
        <code className="mono">20261112170000_pit_checklist.sql</code>) run once in the Supabase SQL editor.
      </p>
      {error.message && (
        <p className="mono text-xs break-words" style={{ color: "var(--muted)" }}>
          {error.message}
        </p>
      )}
      <button type="button" className="btn btn-primary" onClick={reset}>
        Try again <span aria-hidden>→</span>
      </button>
    </div>
  );
}
