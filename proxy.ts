import type { NextRequest } from "next/server";
import { refreshWorkSession } from "@/lib/work-session";

export async function proxy(request: NextRequest) {
  return refreshWorkSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|manifest.json|icon-.*\\.png|favicon.ico|sw.js).*)",
  ],
};
