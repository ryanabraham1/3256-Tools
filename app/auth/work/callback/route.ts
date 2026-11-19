import { cookies } from "next/headers";
import { safeReturnPath } from "@/lib/navigation";
import { NextResponse } from "next/server";
import { workAuthClient } from "@/lib/work-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { bestName, isPlaceholderName } from "@/lib/work-names";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const next = safeReturnPath(jar.get("bt_auth_next")?.value ?? "/work");
  jar.delete("bt_auth_next");
  const login = new URL("/login", url.origin);
  login.searchParams.set("next", next);
  const client = await workAuthClient();
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (
        user?.email_confirmed_at &&
        user.identities?.some((i) => i.provider === "google")
      ) {
        const { data: memberId, error: accessError } = await supabaseAdmin().rpc(
          "claim_work_account",
          { auth_id: user.id },
        );
        if (!accessError) {
          await applyGoogleName(memberId, user.email!, user.user_metadata);
          return NextResponse.redirect(new URL(next, url.origin));
        }
        const denied =
          accessError.message.includes(
            "has not been granted workspace access",
          ) || accessError.message.includes("linked to a different account");
        if (!denied)
          console.error("Work account binding failed", {
            code: accessError.code,
            message: accessError.message,
          });
        await client.auth.signOut({ scope: "local" });
        login.searchParams.set("error", denied ? "access" : "server");
        return NextResponse.redirect(login);
      }
    }
  }
  login.searchParams.set("error", "callback");
  return NextResponse.redirect(login);
}

/** Replace an email-as-name with the person's Google name. Never overwrites a name someone chose. */
async function applyGoogleName(memberId: unknown, email: string, meta: Record<string, unknown> | undefined) {
  if (typeof memberId !== "string") return;
  const google = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "";
  try {
    const db = supabaseAdmin();
    const { data: member } = await db.from("work_items").select("title,revision").eq("id", memberId).eq("kind", "member").maybeSingle();
    if (!member || !isPlaceholderName(member.title, email)) return;
    const name = bestName(email, google).slice(0, 300);
    if (name === member.title) return;
    await db.from("work_items")
      .update({ title: name, revision: member.revision + 1, updated_at: new Date().toISOString() })
      .eq("id", memberId)
      .eq("revision", member.revision);
  } catch (e) {
    console.error("Couldn't update member name", e);
  }
}
