import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkUser, getWorkAccess } from "@/lib/work-auth";
import { AccessPanel } from "@/components/work/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · 3256 Tools" };

export default async function AdminPage() {
  const user = await getWorkUser();
  if (!user || user.role !== "admin") notFound();
  const accounts = await getWorkAccess();
  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/" className="text-sm inline-flex min-h-11 items-center" style={{ color: "var(--muted)" }}>← Home</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mt-1 mb-3">
        <h1 className="display text-2xl sm:text-3xl">People &amp; access</h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Admins manage access · Members edit · Viewers read · People sign in with their own Google account
        </p>
      </div>
      <section className="card p-0 overflow-hidden" aria-label="Manage team accounts">
        <AccessPanel accounts={accounts} currentEmail={user.email} />
      </section>
    </div>
  );
}
