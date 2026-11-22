import "server-only";
import { AwsClient } from "aws4fetch";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * File storage. Uses Cloudflare R2 when the R2_* env vars are set, and
 * Supabase Storage otherwise, so the switch is just setting the env vars once
 * `scripts/copy-storage-to-r2.mjs` has copied the files over.
 *
 * Shaped like the slice of `supabase.storage.from(bucket)` the app used
 * ({ data, error } results), so call sites only swap `db.storage.from(b)` for `bucket(b)`.
 * In R2, every old bucket is a top-level folder of one R2 bucket: `fab-files/parts/…`.
 */
export type BucketName = "fab-files" | "robot-logs" | "work-imports";
type Result<T> = { data: T; error: null } | { data: null; error: Error };
type Body = Blob | Uint8Array | ArrayBuffer | string;

export interface Bucket {
  upload(path: string, body: Body, opts?: { contentType?: string; upsert?: boolean }): Promise<Result<{ path: string }>>;
  remove(paths: string[]): Promise<Result<null>>;
  /** A URL the browser (or Mayhem) PUTs the file's bytes to. Good for 2 hours. */
  createSignedUploadUrl(path: string): Promise<Result<{ path: string; signedUrl: string }>>;
  createSignedUrl(path: string, expiresIn: number, opts?: { download?: string }): Promise<Result<{ signedUrl: string }>>;
  download(path: string): Promise<Result<Blob>>;
  /** The stored file's size, or data: null when there is no such file. */
  info(path: string): Promise<Result<{ size: number } | null>>;
}

const ok = <T,>(data: T): Result<T> => ({ data, error: null });
const fail = (e: unknown): Result<never> => ({ data: null, error: e instanceof Error ? e : new Error(String(e)) });

export const usingR2 = () =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

export function bucket(name: BucketName): Bucket {
  return usingR2() ? r2Bucket(name) : supabaseBucket(name);
}

// ── Cloudflare R2 (S3 API) ───────────────────────────────────────────────────

let _aws: AwsClient | null = null;
const aws = () =>
  (_aws ??= new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  }));

/** URL of one object; each path segment is encoded so names with spaces or # survive. */
export function r2ObjectUrl(name: BucketName, path: string) {
  const key = [name, ...path.split("/")].map(encodeURIComponent).join("/");
  return new URL(`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(process.env.R2_BUCKET!)}/${key}`);
}

async function presign(url: URL, method: "GET" | "PUT", expiresIn: number) {
  url.searchParams.set("X-Amz-Expires", String(Math.max(1, Math.min(604800, Math.round(expiresIn)))));
  const signed = await aws().sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

const asBody = (b: Body): BodyInit => (b instanceof Uint8Array ? new Blob([b as BlobPart]) : b);

function r2Bucket(name: BucketName): Bucket {
  return {
    async upload(path, body, opts) {
      try {
        const res = await aws().fetch(r2ObjectUrl(name, path), {
          method: "PUT",
          body: asBody(body),
          headers: { "content-type": opts?.contentType ?? "application/octet-stream" },
        });
        if (!res.ok) throw new Error(`R2 upload failed (${res.status})`);
        return ok({ path });
      } catch (e) {
        return fail(e);
      }
    },
    async remove(paths) {
      try {
        // One DELETE per file, six at a time (R2 deletes are free; a missing file is not an error).
        for (let i = 0; i < paths.length; i += 6) {
          const results = await Promise.all(
            paths.slice(i, i + 6).map((p) => aws().fetch(r2ObjectUrl(name, p), { method: "DELETE" })),
          );
          const bad = results.find((r) => !r.ok && r.status !== 404);
          if (bad) throw new Error(`R2 delete failed (${bad.status})`);
        }
        return ok(null);
      } catch (e) {
        return fail(e);
      }
    },
    async createSignedUploadUrl(path) {
      try {
        return ok({ path, signedUrl: await presign(r2ObjectUrl(name, path), "PUT", 7200) });
      } catch (e) {
        return fail(e);
      }
    },
    async createSignedUrl(path, expiresIn, opts) {
      try {
        const url = r2ObjectUrl(name, path);
        if (opts?.download)
          url.searchParams.set(
            "response-content-disposition",
            `attachment; filename="${opts.download.replace(/["\\\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(opts.download)}`,
          );
        return ok({ signedUrl: await presign(url, "GET", expiresIn) });
      } catch (e) {
        return fail(e);
      }
    },
    async download(path) {
      try {
        const res = await aws().fetch(r2ObjectUrl(name, path));
        if (!res.ok) throw new Error(res.status === 404 ? "File not found" : `R2 download failed (${res.status})`);
        return ok(await res.blob());
      } catch (e) {
        return fail(e);
      }
    },
    async info(path) {
      try {
        const res = await aws().fetch(r2ObjectUrl(name, path), { method: "HEAD" });
        if (res.status === 404) return ok(null);
        if (!res.ok) throw new Error(`R2 lookup failed (${res.status})`);
        return ok({ size: Number(res.headers.get("content-length") ?? 0) });
      } catch (e) {
        return fail(e);
      }
    },
  };
}

// ── Supabase Storage (until R2 is set up) ────────────────────────────────────

function supabaseBucket(name: BucketName): Bucket {
  const s = () => supabaseAdmin().storage.from(name);
  const wrap = async <T,>(p: PromiseLike<{ data: unknown; error: unknown }>, map: (d: never) => T): Promise<Result<T>> => {
    try {
      const { data, error } = await p;
      if (error) return fail(error instanceof Error ? error : new Error((error as { message?: string }).message ?? "Storage error"));
      return ok(map(data as never));
    } catch (e) {
      return fail(e);
    }
  };
  return {
    upload: (path, body, opts) =>
      wrap(s().upload(path, asBody(body) as Blob, { upsert: opts?.upsert ?? true, contentType: opts?.contentType }), () => ({ path })),
    remove: (paths) => wrap(s().remove(paths), () => null),
    createSignedUploadUrl: (path) =>
      wrap(s().createSignedUploadUrl(path), (d: { path: string; signedUrl: string }) => ({ path: d.path, signedUrl: d.signedUrl })),
    createSignedUrl: (path, expiresIn, opts) =>
      wrap(s().createSignedUrl(path, expiresIn, opts?.download ? { download: opts.download } : undefined), (d: { signedUrl: string }) => ({
        signedUrl: d.signedUrl,
      })),
    download: (path) => wrap(s().download(path), (d: Blob) => d),
    async info(path) {
      const { data, error } = await s().info(path);
      if (error) {
        // a missing file is "no file", not an outage
        const status = (error as { statusCode?: string | number; status?: number }).statusCode ?? (error as { status?: number }).status;
        if (String(status) === "404" || /not.?found/i.test(error.message)) return ok(null);
        return fail(error);
      }
      return ok(data ? { size: Number(data.size) } : null);
    },
  };
}
