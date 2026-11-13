import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import type { OnshapeKeys } from "./onshape";

/**
 * Each person's own Onshape API key pair, so their syncs and exports use their
 * Onshape API allowance. The secret is AES-GCM encrypted with a key derived
 * from the service role key; rotating that key means everyone re-enters theirs.
 */

function cipherKey(): Buffer {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createHash("sha256").update(`onshape-keys:${k}`).digest();
}

function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function open(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
    const d = createDecipheriv("aes-256-gcm", cipherKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function getOnshapeKeys(userId: string): Promise<OnshapeKeys | null> {
  const { data } = await supabaseAdmin().from("onshape_keys").select("access_key,secret_enc").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const secret = open(data.secret_enc as string);
  return secret ? { access: data.access_key as string, secret } : null;
}

export async function saveOnshapeKeys(userId: string, keys: OnshapeKeys): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("onshape_keys")
    .upsert({ user_id: userId, access_key: keys.access, secret_enc: seal(keys.secret), updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function clearOnshapeKeys(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("onshape_keys").delete().eq("user_id", userId);
  if (error) throw error;
}
