import { supabaseAdmin } from "@/lib/supabase";
import {
  LOG_BUCKET,
  MAX_LOG_BYTES,
  logPath,
  readAuth,
  smallJSON,
  uploadAuth,
  validHash,
} from "@/lib/robot-logs/access";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  if (!(await readAuth(request)))
    return json({ error: "Team sign-in or a device token is required" }, 401);
  const before = new URL(request.url).searchParams.get("before");
  if (before && !Number.isFinite(Date.parse(before)))
    return json({ error: "Invalid page cursor" }, 400);
  try {
    const page = (columns: string) => {
      let query = supabaseAdmin()
        .from("robot_logs")
        .select(columns)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(100);
      if (before) query = query.lt("created_at", before);
      return query;
    };
    // Include the uploading device when the device migration is present; fall back without it.
    let { data, error } = await page("sha256,name,size,created_at,device:robot_log_devices(name)");
    if (error) ({ data, error } = await page("sha256,name,size,created_at"));
    if (error)
      return json(
        {
          error:
            "Log library is unavailable. Check the robot-log database migration.",
        },
        503,
      );
    return json({
      logs: data ?? [],
      next: data?.length === 100 ? (data.at(-1) as unknown as { created_at: string }).created_at : null,
    });
  } catch {
    return json({ error: "Log storage is not configured." }, 503);
  }
}
export async function POST(request: Request) {
  const auth = await uploadAuth(request);
  if (!auth)
    return json(
      { error: "Team sign-in or a valid device upload token is required" },
      401,
    );
  let body: Record<string, unknown>;
  try {
    body = await smallJSON(request);
  } catch {
    return json({ error: "Expected valid upload metadata under 8 KB" }, 400);
  }
  if (!validHash(body.sha256))
    return json({ error: "Expected a lowercase SHA-256 hash" }, 400);
  const hash = body.sha256;
  if (
    body.complete !== true &&
    (typeof body.name !== "string" ||
      !body.name.toLowerCase().endsWith(".wpilog") ||
      body.name.length > 200 ||
      /[\x00-\x1f/\\]/.test(body.name) ||
      !Number.isSafeInteger(body.size) ||
      Number(body.size) < 12 ||
      Number(body.size) > MAX_LOG_BYTES)
  )
    return json(
      {
        error:
          "Expected a WPILOG filename and a size between 12 bytes and 250 MB",
      },
      400,
    );
  try {
    const db = supabaseAdmin(),
      storage = db.storage.from(LOG_BUCKET);
    if (body.complete === true) {
      const { data: row, error: rowError } = await db
        .from("robot_logs")
        .select("size,status")
        .eq("sha256", hash)
        .maybeSingle();
      if (rowError) return json({ error: "Log library is unavailable" }, 503);
      if (!row)
        return json({ error: "Start an upload before confirming it" }, 404);
      const { data: file, error } = await storage.info(logPath(hash));
      if (error || !file || Number(file.size) !== row.size)
        return json(
          { error: "The stored file is missing or its size does not match" },
          409,
        );
      const { error: update } = await db
        .from("robot_logs")
        .update({ status: "ready" })
        .eq("sha256", hash);
      if (update)
        return json({ error: "Could not confirm the recording" }, 503);
      return json({ sha256: hash, ready: true });
    }
    const { error: insert } = await db
      .from("robot_logs")
      .upsert(
        {
          sha256: hash,
          name: body.name,
          size: body.size,
          status: "pending",
          ...(auth.kind === "device" ? { device_id: auth.id } : {}),
        },
        { onConflict: "sha256", ignoreDuplicates: true },
      );
    if (insert)
      return json(
        {
          error:
            "Could not start upload. Check the robot-log database migration.",
        },
        503,
      );
    const { data: row, error: rowError } = await db
      .from("robot_logs")
      .select("size,status")
      .eq("sha256", hash)
      .single();
    if (rowError || !row)
      return json({ error: "Could not read upload state" }, 503);
    if (row.size !== body.size)
      return json(
        { error: "A recording with this hash has a different size" },
        409,
      );
    if (row.status === "ready")
      return json({ alreadyUploaded: true, sha256: hash });
    // Recover a successful storage transfer whose confirmation was interrupted.
    const { data: existing } = await storage.info(logPath(hash));
    if (existing && Number(existing.size) === row.size) {
      const { error } = await db
        .from("robot_logs")
        .update({ status: "ready" })
        .eq("sha256", hash);
      if (error)
        return json({ error: "Could not recover upload confirmation" }, 503);
      return json({ alreadyUploaded: true, sha256: hash });
    }
    const { data, error } = await storage.createSignedUploadUrl(logPath(hash));
    if (error || !data)
      return json(
        {
          error:
            "Could not create a storage upload. Check the private robot-logs bucket.",
        },
        503,
      );
    return json({ uploadUrl: data.signedUrl, sha256: hash });
  } catch {
    return json({ error: "Log storage is unavailable" }, 503);
  }
}
