import { supabaseAdmin } from "@/lib/supabase";
import { teamRequest } from "@/lib/robot-logs/access";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Revokes a device token immediately. Logs it already uploaded stay in the library. */
export async function DELETE(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  if (!(await teamRequest(request))) return json({ error: "Team sign-in required" }, 401);
  const { deviceId } = await params;
  if (!UUID.test(deviceId)) return json({ error: "Invalid device ID" }, 400);
  try {
    const { data, error } = await supabaseAdmin()
      .from("robot_log_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", deviceId)
      .is("revoked_at", null)
      .select("id");
    if (error) return json({ error: "Could not revoke the device." }, 503);
    if (!data?.length) return json({ error: "That device was already revoked or doesn't exist." }, 404);
    return json({ revoked: deviceId });
  } catch {
    return json({ error: "Log storage is not configured." }, 503);
  }
}
