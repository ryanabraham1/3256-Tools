import { supabaseAdmin } from "@/lib/supabase";
import { newDeviceToken, smallJSON, teamRequest } from "@/lib/robot-logs/access";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const MAX_DEVICES = 50;

/** Devices that may upload logs. Never returns tokens or their hashes. */
export async function GET(request: Request) {
  if (!(await teamRequest(request))) return json({ error: "Team sign-in required" }, 401);
  try {
    const { data, error } = await supabaseAdmin()
      .from("robot_log_devices")
      .select("id,name,created_at,last_used_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) return json({ error: "Device tokens need the robot-log devices database migration." }, 503);
    return json({ devices: data ?? [] });
  } catch {
    return json({ error: "Log storage is not configured." }, 503);
  }
}

/** Creates a device token. The token is returned once and only its hash is stored. */
export async function POST(request: Request) {
  if (!(await teamRequest(request))) return json({ error: "Team sign-in required" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await smallJSON(request);
  } catch {
    return json({ error: "Expected a device name" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60 || /[\x00-\x1f]/.test(name))
    return json({ error: "Name the device in 1 to 60 characters, e.g. “Ryan’s MacBook”." }, 400);
  try {
    const db = supabaseAdmin();
    const { count, error: countError } = await db
      .from("robot_log_devices")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null);
    if (countError) return json({ error: "Device tokens need the robot-log devices database migration." }, 503);
    if ((count ?? 0) >= MAX_DEVICES)
      return json({ error: `Revoke an unused device first (limit ${MAX_DEVICES}).` }, 409);
    const { token, hash } = newDeviceToken();
    const { data, error } = await db
      .from("robot_log_devices")
      .insert({ name, token_hash: hash })
      .select("id,name,created_at,last_used_at")
      .single();
    if (error || !data) return json({ error: "Could not create the device token." }, 503);
    return json({ device: data, token }, 201);
  } catch {
    return json({ error: "Log storage is not configured." }, 503);
  }
}
