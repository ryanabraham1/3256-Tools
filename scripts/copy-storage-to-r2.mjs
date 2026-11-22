// One-time copy of every Supabase Storage file into Cloudflare R2.
//
//   node --env-file=.env.local scripts/copy-storage-to-r2.mjs          (copy)
//   node --env-file=.env.local scripts/copy-storage-to-r2.mjs --dry    (just count)
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the R2_* vars.
// Each Supabase bucket becomes a top-level folder of the one R2 bucket
// (fab-files/parts/…, robot-logs/<hash>.wpilog, work-imports/linear/…), which
// is where lib/storage.ts looks. Safe to re-run: files already in R2 with the
// same size are skipped, so an interrupted copy just picks up where it stopped.
import { createClient } from "@supabase/supabase-js";
import { AwsClient } from "aws4fetch";

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} (put it in .env.local)`);
  return v;
};
const dry = process.argv.includes("--dry");
const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const aws = new AwsClient({
  accessKeyId: env("R2_ACCESS_KEY_ID"),
  secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  service: "s3",
  region: "auto",
});
const account = env("R2_ACCOUNT_ID");
const r2Bucket = env("R2_BUCKET");
const objectUrl = (bucket, path) =>
  `https://${account}.r2.cloudflarestorage.com/${encodeURIComponent(r2Bucket)}/` +
  [bucket, ...path.split("/")].map(encodeURIComponent).join("/");

async function* walk(bucket, prefix = "") {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Listing ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) yield* walk(bucket, path); // a folder
      else yield { path, size: Number(item.metadata?.size ?? 0), type: item.metadata?.mimetype };
    }
    if (data.length < 1000) return;
  }
}

const { data: buckets, error } = await sb.storage.listBuckets();
if (error) throw new Error(`Couldn't list Supabase buckets: ${error.message}`);
const known = new Set(["fab-files", "robot-logs", "work-imports"]);
for (const b of buckets) if (!known.has(b.name)) console.warn(`Note: bucket "${b.name}" isn't used by the app; copying it anyway.`);

let copied = 0, skipped = 0, failed = 0, bytes = 0;
for (const { name: bucket } of buckets) {
  for await (const file of walk(bucket)) {
    const url = objectUrl(bucket, file.path);
    const head = await aws.fetch(url, { method: "HEAD" });
    if (head.ok && Number(head.headers.get("content-length")) === file.size) {
      skipped++;
      continue;
    }
    if (dry) {
      console.log(`would copy ${bucket}/${file.path} (${(file.size / 1e6).toFixed(1)} MB)`);
      copied++;
      bytes += file.size;
      continue;
    }
    try {
      const { data: blob, error: de } = await sb.storage.from(bucket).download(file.path);
      if (de || !blob) throw new Error(de?.message ?? "empty download");
      const res = await aws.fetch(url, {
        method: "PUT",
        body: blob,
        headers: { "content-type": file.type || blob.type || "application/octet-stream" },
      });
      if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${await res.text()}`);
      copied++;
      bytes += blob.size;
      console.log(`copied ${bucket}/${file.path} (${(blob.size / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      failed++;
      console.error(`FAILED ${bucket}/${file.path}: ${e.message}`);
    }
  }
}
console.log(
  `\n${dry ? "Would copy" : "Copied"} ${copied} files (${(bytes / 1e9).toFixed(2)} GB), ${skipped} already in R2, ${failed} failed.` +
    (failed ? "\nRe-run to retry the failed ones." : ""),
);
process.exit(failed ? 1 : 0);
