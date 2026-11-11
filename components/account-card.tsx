import Link from "next/link";
import type { WorkUser } from "@/lib/work-auth";

export function AccountCard({ user }: { user: WorkUser }) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return (
    <section aria-label="Your account" className="card mb-4 p-4 sm:p-5 flex flex-wrap items-center gap-4">
      <span aria-hidden className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center font-semibold" style={{ background: "var(--purple-soft)", color: "var(--purple-dark)" }}>{initials}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-lg break-words">{user.name}</p>
        <p className="text-sm break-all" style={{ color: "var(--muted)" }}>{user.email}</p>
      </div>
      <span className="pill pill-muted capitalize">{user.role}</span>
      {user.role === "admin" && <Link href="/admin" className="btn btn-ghost text-sm">Manage access <span aria-hidden>→</span></Link>}
    </section>
  );
}
