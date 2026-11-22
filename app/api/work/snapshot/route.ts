import { requireWorkUser } from "@/lib/work-auth";
import { getWork } from "@/lib/work-data";
const headers = { "Cache-Control": "private, no-store" };
/**
 * The live workspace as JSON. Work re-reads this in the background instead of re-rendering the page.
 * `?since=<an earlier snapshot's now>` sends only what changed (see mergeWorkDelta).
 */
export async function GET(request: Request) {
  try {
    await requireWorkUser();
  } catch {
    return Response.json({ error: "Sign in with Google to open Work." }, { status: 401, headers });
  }
  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  return Response.json(await getWork(false, since), { headers });
}
