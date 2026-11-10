import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isAuthed } from "@/lib/auth";
/** Device token grants upload only. Team cookies are still required to browse/download. */
export async function mayUploadLogs(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = process.env.ROBOT_LOG_UPLOAD_TOKEN;
  if (
    authorization.startsWith("Bearer ") &&
    expected &&
    expected.length >= 32
  ) {
    const digest = (s: string) => createHash("sha256").update(s).digest();
    if (timingSafeEqual(digest(authorization.slice(7)), digest(expected)))
      return true;
  }
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
