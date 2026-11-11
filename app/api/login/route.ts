import { NextResponse } from "next/server";

// Old clients must sign in with an individual Google account.
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Team-code sign-in has been retired. Sign in with Google at /login." },
    { status: 410 },
  );
}
