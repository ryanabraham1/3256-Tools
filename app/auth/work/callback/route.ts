import { cookies } from "next/headers";
import { safeReturnPath } from "@/lib/navigation";
import { NextResponse } from "next/server";
import { workAuthClient } from "@/lib/work-auth";
import { supabaseAdmin } from "@/lib/supabase";
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
        const { error: accessError } = await supabaseAdmin().rpc(
          "claim_work_account",
          { auth_id: user.id },
        );
        if (!accessError) return NextResponse.redirect(new URL(next, url.origin));
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
