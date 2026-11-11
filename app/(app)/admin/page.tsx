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
      <p className="eyebrow mt-3" style={{ color: "var(--muted)" }}>Team administration</p>
      <h1 className="display text-3xl sm:text-4xl mt-1">People &amp; access</h1>
      <p className="text-sm mt-3 mb-6 max-w-xl" style={{ color: "var(--muted)" }}>Manage who can use 3256 Tools and what they can change. These permissions apply across all team tools.</p>
      <section className="card p-4 sm:p-6" aria-label="Manage team accounts">
        <AccessPanel accounts={accounts} currentEmail={user.email} />
      </section>
    </div>
  );
}
