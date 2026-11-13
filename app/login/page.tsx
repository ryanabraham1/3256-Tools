import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { safeReturnPath } from "@/lib/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import "./login.css";

export const metadata = { title: "Sign in — 3256 Tools" };

// The sign-in page is drawn as an engineering drawing sheet: zone border, title block, parts list.
const TOOLS = ["Work", "Batteries", "Fab stock", "Parts", "Pit", "Robot logs"];
const COLUMNS = ["1", "2", "3", "4", "5", "6"];
const ROWS = ["A", "B", "C", "D"];

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = safeReturnPath(typeof sp.next === "string" ? sp.next : "/");
  if (await isAuthed()) redirect(next);
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const message = error === "access"
    ? "This Google account isn't on the team. Ask an admin to add it."
    : error === "provider"
      ? "Google sign-in is unavailable. Try again."
      : error ? "Sign-in didn't finish. Try again." : null;
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
  return (
    <main className="sheet">
      <div className="sheet-zones is-top" aria-hidden>{COLUMNS.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="sheet-zones is-left" aria-hidden>{ROWS.map((r) => <span key={r}>{r}</span>)}</div>
      <div className="sheet-zones is-right" aria-hidden>{ROWS.map((r) => <span key={r}>{r}</span>)}</div>
      <div className="sheet-zones is-bottom" aria-hidden>{COLUMNS.map((c) => <span key={c}>{c}</span>)}</div>

      <div className="sheet-body">
        <div className="sheet-corner"><ThemeToggle /></div>

        <section className="sheet-hero">
          <p className="sheet-label">FRC Team</p>
          <h1 className="sheet-number">3256</h1>
          <div className="sheet-dim" aria-hidden>
            <i /><span>Team tools</span><i />
          </div>
        </section>

        <div className="sheet-foot">
          <table className="sheet-parts">
            <thead>
              <tr><th>Item</th><th>Description</th><th>Qty</th></tr>
            </thead>
            <tbody>
              {TOOLS.map((t, i) => (
                <tr key={t}><td>{String(i + 1).padStart(2, "0")}</td><td>{t}</td><td>1</td></tr>
              ))}
            </tbody>
          </table>

          <div className="sheet-title">
            <div className="sheet-cell is-wide">
              <span>Title</span>
              <strong>Team tools</strong>
            </div>
            <div className="sheet-cell"><span>Dwg no.</span><code>3256-001</code></div>
            <div className="sheet-cell"><span>Date</span><code>{date}</code></div>
            <div className="sheet-cell"><span>Access</span><code>Team only</code></div>
            <div className="sheet-cell"><span>Sheet</span><code>1 of 1</code></div>
            {message && (
              <p role="alert" className="sheet-cell is-wide is-alert">
                <span>Note</span>
                {message}
              </p>
            )}
            <LoginForm next={next} />
          </div>
        </div>
      </div>
    </main>
  );
}
