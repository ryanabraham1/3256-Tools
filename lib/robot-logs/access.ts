import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const DEVICE_TOKEN_PREFIX = "mhm_";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
/** A new device token: shown to the user once, stored only as its hash. */
export function newDeviceToken() {
  const token = DEVICE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export type UploadAuth = { kind: "team" } | { kind: "shared" } | { kind: "device"; id: string; name: string };

/** A device token that has not been revoked, or null. Never throws; a database outage fails closed. */
async function deviceFor(token: string): Promise<{ id: string; name: string } | null> {
  if (!token.startsWith(DEVICE_TOKEN_PREFIX) || token.length < 40 || token.length > 100) return null;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("robot_log_devices")
      .select("id,name")
      .eq("token_hash", hashToken(token))
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !data) return null;
    // Best effort: a failed timestamp update must not block the request.
    try {
      await db
        .from("robot_log_devices")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", data.id);
    } catch {}
    return { id: data.id, name: data.name };
  } catch {
    return null;
  }
}
const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
};

/**
 * Who may upload: a signed-in teammate (same-origin), the legacy shared token, or a device token
 * that has not been revoked.
 */
export async function uploadAuth(request: Request): Promise<UploadAuth | null> {
  const token = bearerToken(request);
  if (token !== null) {
    const shared = process.env.ROBOT_LOG_UPLOAD_TOKEN;
    if (shared && shared.length >= 32) {
      const digest = (s: string) => createHash("sha256").update(s).digest();
      if (timingSafeEqual(digest(token), digest(shared))) return { kind: "shared" };
    }
    const device = await deviceFor(token);
    return device ? { kind: "device", ...device } : null;
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return null;
  return (await isAuthed()) ? { kind: "team" } : null;
}
/**
 * Who may browse and download team recordings: a signed-in teammate, or a revocable device token
 * created by one (Mayhem's Team cloud list). The legacy shared token stays upload-only.
 */
export async function readAuth(request: Request): Promise<boolean> {
  const token = bearerToken(request);
  if (token !== null) return (await deviceFor(token)) !== null;
  return isAuthed();
}
export async function mayUploadLogs(request: Request): Promise<boolean> {
  return (await uploadAuth(request)) !== null;
}
/** Team-only management routes reject cross-site requests even with a valid cookie. */
export async function teamRequest(request: Request): Promise<boolean> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return isAuthed();
}
export async function smallJSON(
  request: Request,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("Request metadata exceeds 8 KB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected JSON metadata");
  return input as Record<string, unknown>;
}
export const LOG_BUCKET = "robot-logs";
export const MAX_LOG_BYTES = 250 * 1024 * 1024;
export const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const logPath = (hash: string) => `${hash}.wpilog`;
