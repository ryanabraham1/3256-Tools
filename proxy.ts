import type { NextRequest } from "next/server";
import { refreshWorkSession } from "@/lib/work-session";

export async function proxy(request: NextRequest) {
  return refreshWorkSession(request);
}

export const config = {
  matcher: [
    // The binder and the upstream viewer's bundles/models are public assets.
    // Keep the viewer entry page and all log APIs behind their existing checks.
    "/((?!_next/static|_next/image|manifest.json|icon-.*\\.png|favicon.ico|sw.js|binder(?:/|$)|advantagescope/(?:assets(?:/|$)|bundles/|icons/|asset-index\\.json$)).*)",
  ],
};
