import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { workAuthClient } from "@/lib/work-auth";
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin)
    return new NextResponse("Invalid origin", { status: 403 });
  const client = await workAuthClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) return new NextResponse("Sign-out failed. Please try again.", { status: 503 });
  const jar = await cookies();
  jar.delete("bt_session");
  jar.delete("bt_auth_next");
  return NextResponse.redirect(`${origin}/login`, 303);
}
