import { PROBLEM_STATUSES, validateRobotIssue } from "@/lib/pit";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorkUser } from "@/lib/work-auth";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Reports a robot issue or changes its status, from Work. Robot issues are the pit problem log, so
 * the Pit pages see the same rows. A plain request like /api/work/save: it returns the saved row
 * instead of re-rendering the workspace.
 */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ ok: false, error: "Invalid origin." }, { status: 403, headers });
  try {
    const user = await requireWorkUser(true);
    const body = (await request.json()) as Record<string, unknown>;
    const db = supabaseAdmin();
    if (body.action === "report") {
      const issue = validateRobotIssue(body);
      // At a competition the issue belongs to it; from the shop it doesn't.
      const { data: active } = body.atEvent
        ? await db.from("pit_events").select("id").eq("active", true).maybeSingle()
        : { data: null };
      const { data, error } = await db
        .from("pit_problems")
        .insert({ ...issue, event_id: active?.id ?? null, reported_by: user.name })
        .select()
        .single();
      if (error) throw error;
      return Response.json({ ok: true, problem: data }, { headers });
    }
    if (body.action === "status") {
      if (typeof body.id !== "string" || !uuid.test(body.id)) throw new Error("No such robot issue.");
      if (!(PROBLEM_STATUSES as readonly string[]).includes(String(body.status))) throw new Error("Pick a status.");
      const { data, error } = await db
        .from("pit_problems")
        .update({ status: body.status, resolved_at: body.status === "open" ? null : new Date().toISOString() })
        .eq("id", body.id)
        .select()
        .single();
      if (error) throw error;
      return Response.json({ ok: true, problem: data }, { headers });
    }
    throw new Error("Unknown action.");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save the robot issue.";
    return Response.json({ ok: false, error: message }, { status: 400, headers });
  }
}
