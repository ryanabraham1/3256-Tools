import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash, timingSafeEqual } from "node:crypto";
function load(file, imports, extra = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import ${name}`);
    },
    Request,
    Response,
    URL,
    Buffer,
    AbortSignal,
    ...extra,
  });
  return module.exports;
}
const access = (authed = false, token = "a".repeat(40)) =>
  load(
    "lib/robot-logs/access.ts",
    {
      "server-only": {},
      "node:crypto": { createHash, timingSafeEqual },
      "@/lib/auth": { isAuthed: async () => authed },
    },
    { process: { env: { ROBOT_LOG_UPLOAD_TOKEN: token } } },
  );
test("upload tokens do not grant team browsing, and invalid tokens fail closed", async () => {
  const a = access();
  assert.equal(
    await a.mayUploadLogs(
      new Request("https://tools.test/api/robot-logs", {
        headers: { authorization: "Bearer " + "a".repeat(40) },
      }),
    ),
    true,
  );
  assert.equal(
    await a.mayUploadLogs(
      new Request("https://tools.test/api/robot-logs", {
        headers: { authorization: "Bearer wrong" },
      }),
    ),
    false,
  );
  assert.equal(
    await access(true).mayUploadLogs(
      new Request("https://tools.test/api/robot-logs", {
        headers: { origin: "https://attacker.test" },
      }),
    ),
    false,
  );
  const routes = load("app/api/robot-logs/route.ts", {
    "@/lib/auth": { isAuthed: async () => false },
    "@/lib/supabase": {
      supabaseAdmin: () => {
        throw new Error("must not access DB");
      },
    },
    "@/lib/robot-logs/access": a,
  });
  assert.equal(
    (
      await routes.GET(
        new Request("https://tools.test/api/robot-logs", {
          headers: { authorization: "Bearer " + "a".repeat(40) },
        }),
      )
    ).status,
    401,
  );
});
test("metadata input is bounded before database access", async () => {
  const a = access();
  await assert.rejects(
    () =>
      a.smallJSON(
        new Request("https://tools.test", {
          method: "POST",
          body: "x".repeat(9000),
        }),
      ),
    /8 KB/,
  );
  const routes = load("app/api/robot-logs/route.ts", {
    "@/lib/auth": { isAuthed: async () => true },
    "@/lib/supabase": {
      supabaseAdmin: () => {
        throw new Error("must not access DB");
      },
    },
    "@/lib/robot-logs/access": access(true),
  });
  for (const body of [
    { sha256: "bad", name: "test.wpilog", size: 12 },
    { sha256: "a".repeat(64), name: "../test.wpilog", size: 12 },
    { sha256: "a".repeat(64), name: "test.wpilog", size: 300 * 1024 * 1024 },
  ])
    assert.equal(
      (
        await routes.POST(
          new Request("https://tools.test/api/robot-logs", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        )
      ).status,
      400,
    );
});
function routesFor({
  storedSize = 12,
  status = "pending",
  fileSize = null,
} = {}) {
  const row = { size: storedSize, status };
  let signed = 0,
    updates = 0;
  const db = {
    from() {
      const q = {
        upsert: async () => ({ error: null }),
        select: () => q,
        eq: () => q,
        single: async () => ({ data: row, error: null }),
        maybeSingle: async () => ({ data: row, error: null }),
        update() {
          updates++;
          return q;
        },
        then(resolve) {
          resolve({ data: row, error: null });
        },
      };
      return q;
    },
    storage: {
      from() {
        return {
          info: async () => ({
            data: fileSize === null ? null : { size: fileSize },
            error: null,
          }),
          createSignedUploadUrl: async () => {
            signed++;
            return {
              data: { signedUrl: "https://storage.test/signed" },
              error: null,
            };
          },
        };
      },
    },
  };
  const routes = load("app/api/robot-logs/route.ts", {
    "@/lib/auth": { isAuthed: async () => true },
    "@/lib/supabase": { supabaseAdmin: () => db },
    "@/lib/robot-logs/access": access(true),
  });
  return { ...routes, counts: () => ({ signed, updates }) };
}
const post = (body) =>
  new Request("https://tools.test/api/robot-logs", {
    method: "POST",
    body: JSON.stringify(body),
  });
const metadata = { sha256: "a".repeat(64), name: "test.wpilog", size: 12 };
test("uploads go directly to signed private storage and retries recover confirmation", async () => {
  const fresh = routesFor();
  const response = await fresh.POST(post(metadata));
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).uploadUrl,
    "https://storage.test/signed",
  );
  assert.equal(fresh.counts().signed, 1);
  const retry = routesFor({ fileSize: 12 });
  assert.equal(
    (await (await retry.POST(post(metadata))).json()).alreadyUploaded,
    true,
  );
  assert.equal(retry.counts().signed, 0);
  assert.equal(retry.counts().updates, 1);
});
test("confirmation refuses truncated or mismatched stored files", async () => {
  const routes = routesFor({ fileSize: 11 });
  assert.equal(
    (await routes.POST(post({ sha256: metadata.sha256, complete: true })))
      .status,
    409,
  );
  assert.equal(routes.counts().updates, 0);
});
