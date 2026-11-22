import { supabaseAdmin } from "@/lib/supabase";
import { LOG_BUCKET, logPath, readAuth, validHash } from "@/lib/robot-logs/access";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await readAuth(request)))
    return Response.json({ error: "Team sign-in or a device token is required" }, { status: 401 });
  const { id } = await params;
  if (!validHash(id))
    return Response.json({ error: "Invalid recording ID" }, { status: 400 });
  try {
    const db = supabaseAdmin();
    const { data: row } = await db
      .from("robot_logs")
      .select("name")
      .eq("sha256", id)
      .eq("status", "ready")
      .maybeSingle();
    if (!row)
      return Response.json({ error: "Recording not found" }, { status: 404 });
    const { data, error } = await db.storage
      .from(LOG_BUCKET)
      .createSignedUrl(logPath(id), 120);
    if (error || !data)
      return Response.json({ error: "Recording unavailable" }, { status: 503 });
    return Response.json(
      { url: data.signedUrl, name: row.name },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json({ error: "Recording unavailable" }, { status: 503 });
  }
}
