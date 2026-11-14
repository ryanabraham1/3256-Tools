import { requireWorkUser } from "@/lib/work-auth";
import { getWork } from "@/lib/work-data";
const headers = { "Cache-Control": "private, no-store" };
/** The live workspace as JSON. Work re-reads this in the background instead of re-rendering the page. */
export async function GET() {
  try {
    await requireWorkUser();
  } catch {
    return Response.json({ error: "Sign in with Google to open Work." }, { status: 401, headers });
  }
  return Response.json(await getWork(), { headers });
}
