import { getWorkUser } from "@/lib/work-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { LOG_BUCKET, logPath, validHash } from "@/lib/robot-logs/access";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Permanently deletes a team recording: the stored file and its library row. Team admins only,
 * from a same-site request; device tokens and the shared upload token can never delete.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.has("authorization"))
    return json({ error: "Only signed-in team admins can delete recordings" }, 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Cross-site request refused" }, 403);
  const user = await getWorkUser();
  if (!user) return json({ error: "Team sign-in required" }, 401);
  if (user.role !== "admin") return json({ error: "Only team admins can delete recordings" }, 403);
  const { id } = await params;
  if (!validHash(id)) return json({ error: "Invalid recording ID" }, 400);
  try {
    const db = supabaseAdmin();
    const { data: row, error: rowError } = await db.from("robot_logs").select("sha256").eq("sha256", id).maybeSingle();
    if (rowError) return json({ error: "Log library is unavailable" }, 503);
    if (!row) return json({ error: "Recording not found" }, 404);
    // Remove the file first: a leftover row for a missing file is visible and retryable, an orphaned file is not.
    const { error: storageError } = await db.storage.from(LOG_BUCKET).remove([logPath(id)]);
    if (storageError) return json({ error: "Could not delete the stored recording" }, 503);
    const { error } = await db.from("robot_logs").delete().eq("sha256", id);
    if (error) return json({ error: "The file was deleted but the library entry remains. Try again." }, 503);
    return json({ deleted: id });
  } catch {
    return json({ error: "Log storage is not configured." }, 503);
  }
}
