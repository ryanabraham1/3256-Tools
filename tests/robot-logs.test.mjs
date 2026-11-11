import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
const access = (authed = false, token = "a".repeat(40), db = null) =>
  load(
    "lib/robot-logs/access.ts",
    {
      "server-only": {},
      "node:crypto": { createHash, randomBytes, timingSafeEqual },
      "@/lib/auth": { isAuthed: async () => authed },
      "@/lib/supabase": {
        supabaseAdmin: () => {
          if (!db) throw new Error("must not access DB");
          return db;
        },
      },
    },
    { process: { env: { ROBOT_LOG_UPLOAD_TOKEN: token } } },
  );
test('sign-in preserves the shared recording URL and its query string',async()=>{
  const {proxy}=load('proxy.ts',{'next/server':{NextResponse:{redirect:url=>({location:url.toString()}),next:()=>({next:true})}},'@/lib/work-session':{refreshWorkSession:async()=>{throw new Error('unrelated work session');}}},{process:{env:{SESSION_SECRET:'test-only'}}});
  const url=new URL('https://tools.test/logs?log='+'a'.repeat(64));
  const response=await proxy({nextUrl:url,url:url.toString(),cookies:{get:()=>undefined}});
  assert.equal(new URL(response.location).searchParams.get('next'),url.pathname+url.search);
});
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

/** A tiny in-memory stand-in for the robot_log_devices table. */
function deviceDB(devices = []) {
  const calls = [];
  return {
    devices,
    calls,
    from(table) {
      const filters = [];
      let patch = null,
        insert = null;
      const rows = () => devices.filter((d) => filters.every((f) => f(d)));
      const q = {
        select: () => q,
        order: () => q,
        eq(column, value) {
          filters.push((d) => d[column] === value);
          return q;
        },
        is(column, value) {
          filters.push((d) => (d[column] ?? null) === value);
          return q;
        },
        update(values) {
          patch = values;
          return q;
        },
        insert(values) {
          insert = { id: `00000000-0000-4000-8000-${String(devices.length).padStart(12, "0")}`, created_at: "2026-11-11T00:00:00Z", last_used_at: null, ...values };
          return q;
        },
        async maybeSingle() {
          calls.push(table);
          return { data: rows()[0] ?? null, error: null };
        },
        async single() {
          if (insert) devices.push(insert);
          return { data: insert, error: null };
        },
        then(resolve) {
          if (patch) {
            const hit = rows();
            hit.forEach((d) => Object.assign(d, patch));
            resolve({ data: hit, error: null });
          } else resolve({ data: rows(), count: rows().length, error: null });
        },
      };
      return q;
    },
  };
}
const bearer = (token) =>
  new Request("https://tools.test/api/robot-logs", { headers: { authorization: "Bearer " + token } });

test("device tokens upload until revoked, and only their hash is ever looked up", async () => {
  const token = "mhm_" + "x".repeat(43);
  const hash = createHash("sha256").update(token).digest("hex");
  const db = deviceDB([{ id: "d1", name: "Pit laptop", token_hash: hash, revoked_at: null }]);
  const a = access(false, "", db);
  assert.deepEqual({ ...(await a.uploadAuth(bearer(token))) }, { kind: "device", id: "d1", name: "Pit laptop" });
  assert.ok(db.devices[0].last_used_at, "records when the device was last used");
  assert.equal(await a.uploadAuth(bearer("mhm_" + "y".repeat(43))), null);
  db.devices[0].revoked_at = "2026-11-11T00:00:00Z";
  assert.equal(await a.uploadAuth(bearer(token)), null);
  // Tokens without the device prefix never reach the database.
  const quiet = deviceDB();
  assert.equal(await access(false, "", quiet).uploadAuth(bearer("z".repeat(50))), null);
  assert.equal(quiet.calls.length, 0);
});

test("the legacy shared token still uploads and a database outage fails closed", async () => {
  const a = access(false, "s".repeat(40), deviceDB());
  assert.deepEqual({ ...(await a.uploadAuth(bearer("s".repeat(40)))) }, { kind: "shared" });
  const broken = access(false, "", { from() { throw new Error("db down"); } });
  assert.equal(await broken.uploadAuth(bearer("mhm_" + "x".repeat(43))), null);
});

test("teammates create, list and revoke devices; tokens are shown once and stored hashed", async () => {
  const db = deviceDB();
  const a = access(true, "", db);
  const imports = {
    "@/lib/supabase": { supabaseAdmin: () => db },
    "@/lib/robot-logs/access": a,
  };
  const devices = load("app/api/robot-logs/devices/route.ts", imports);
  const created = await devices.POST(
    new Request("https://tools.test/api/robot-logs/devices", { method: "POST", body: JSON.stringify({ name: "Pit laptop" }) }),
  );
  assert.equal(created.status, 201);
  const { token, device } = await created.json();
  assert.match(token, /^mhm_[A-Za-z0-9_-]{43}$/);
  assert.equal(db.devices[0].token_hash, createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(db.devices).includes(token), "the raw token is never stored");
  const listed = await (await devices.GET(new Request("https://tools.test/api/robot-logs/devices"))).json();
  assert.equal(listed.devices.length, 1);
  assert.ok(!JSON.stringify(listed).includes(token));
  assert.equal((await a.uploadAuth(bearer(token))).kind, "device");
  const one = load("app/api/robot-logs/devices/[deviceId]/route.ts", imports);
  const revoked = await one.DELETE(new Request("https://tools.test/x", { method: "DELETE" }), {
    params: Promise.resolve({ deviceId: device.id }),
  });
  assert.equal(revoked.status, 200);
  assert.equal(await a.uploadAuth(bearer(token)), null);
  for (const name of ["", "x".repeat(61)])
    assert.equal(
      (await devices.POST(new Request("https://tools.test/api/robot-logs/devices", { method: "POST", body: JSON.stringify({ name }) }))).status,
      400,
    );
});

test("device management needs a same-site team sign-in, not an upload token", async () => {
  const db = deviceDB();
  const outsider = load("app/api/robot-logs/devices/route.ts", {
    "@/lib/supabase": { supabaseAdmin: () => db },
    "@/lib/robot-logs/access": access(false, "s".repeat(40), db),
  });
  assert.equal((await outsider.GET(bearer("s".repeat(40)))).status, 401);
  const crossSite = load("app/api/robot-logs/devices/route.ts", {
    "@/lib/supabase": { supabaseAdmin: () => db },
    "@/lib/robot-logs/access": access(true, "", db),
  });
  assert.equal(
    (await crossSite.POST(new Request("https://tools.test/api/robot-logs/devices", { method: "POST", headers: { origin: "https://attacker.test" }, body: JSON.stringify({ name: "x" }) }))).status,
    401,
  );
});
