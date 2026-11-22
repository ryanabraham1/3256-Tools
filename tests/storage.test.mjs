import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const requireDependency = createRequire(import.meta.url);
const plain = (v) => JSON.parse(JSON.stringify(v)); // objects made inside the vm sandbox

/** lib/storage.ts with R2 env set and every R2 request answered by `respond`. */
function loadStorage(respond, env = {}) {
  const seen = [];
  const js = ts.transpileModule(fs.readFileSync('lib/storage.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  class AwsClient {
    async sign(req) {
      const u = new URL(req.url);
      u.searchParams.set('X-Amz-Signature', 'sig');
      return new Request(u, { method: req.method });
    }
    async fetch(url, init = {}) {
      seen.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} });
      return respond(String(url), init.method ?? 'GET');
    }
  }
  const supabaseCalls = [];
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, URL, Request, Response, Blob, encodeURIComponent,
    process: { env: { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'team-files', ...env } },
    require: (name) =>
      name === 'server-only' ? {} :
      name === 'aws4fetch' ? { AwsClient } :
      name === '@/lib/supabase' ? { supabaseAdmin: () => ({ storage: { from: (b) => { supabaseCalls.push(b); return { info: async () => ({ data: null, error: { message: 'Object not found', statusCode: '404' } }) }; } } }) } :
      requireDependency(name),
  });
  return { ...mod.exports, seen, supabaseCalls };
}

test('R2 keeps each old bucket as a folder and encodes awkward file names', async () => {
  const s = loadStorage(() => new Response(null, { status: 200 }));
  assert.equal(s.usingR2(), true);
  assert.equal(
    String(s.r2ObjectUrl('fab-files', 'parts/abc/1x-bracket #2 v1.dxf')),
    'https://acct.r2.cloudflarestorage.com/team-files/fab-files/parts/abc/1x-bracket%20%232%20v1.dxf',
  );
  const up = await s.bucket('robot-logs').createSignedUploadUrl('f00.wpilog');
  assert.equal(up.error, null);
  assert.equal(up.data.path, 'f00.wpilog');
  const u = new URL(up.data.signedUrl);
  assert.equal(u.pathname, '/team-files/robot-logs/f00.wpilog');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '7200');
  assert.ok(u.searchParams.get('X-Amz-Signature'));
});

test('R2 signed downloads can name the saved file', async () => {
  const s = loadStorage(() => new Response(null));
  const { data } = await s.bucket('fab-files').createSignedUrl('parts/a/x.stl', 300, { download: 'Arm "v2".stl' });
  const u = new URL(data.signedUrl);
  assert.equal(u.searchParams.get('X-Amz-Expires'), '300');
  assert.match(u.searchParams.get('response-content-disposition'), /^attachment; filename="Arm _v2_.stl"; filename\*=UTF-8''Arm%20%22v2%22.stl$/);
});

test('R2 info reports a missing file as no file, and size from the object', async () => {
  const s = loadStorage((url) =>
    url.endsWith('/gone.wpilog') ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { 'content-length': '1234' } }),
  );
  assert.deepEqual(plain(await s.bucket('robot-logs').info('gone.wpilog')), { data: null, error: null });
  assert.deepEqual(plain(await s.bucket('robot-logs').info('here.wpilog')), { data: { size: 1234 }, error: null });
  assert.equal(s.seen.at(-1).method, 'HEAD');
});

test('R2 remove deletes every path, ignores missing ones, and reports real failures', async () => {
  const s = loadStorage((url) => new Response(null, { status: url.includes('missing') ? 404 : 204 }));
  const paths = Array.from({ length: 14 }, (_, i) => `parts/p/${i}.dxf`).concat('parts/p/missing.dxf');
  assert.equal((await s.bucket('fab-files').remove(paths)).error, null);
  assert.equal(s.seen.filter((r) => r.method === 'DELETE').length, 15);
  const broken = loadStorage(() => new Response(null, { status: 500 }));
  assert.match((await broken.bucket('fab-files').remove(['a'])).error.message, /500/);
});

test('R2 upload and download surface HTTP errors instead of throwing', async () => {
  const s = loadStorage((_, method) => new Response(method === 'PUT' ? null : 'dxf text', { status: method === 'PUT' ? 403 : 200 }));
  const up = await s.bucket('fab-files').upload('parts/a/x.dxf', 'text', { contentType: 'application/dxf' });
  assert.match(up.error.message, /403/);
  assert.equal(s.seen[0].headers['content-type'], 'application/dxf');
  const down = await s.bucket('fab-files').download('parts/a/x.dxf');
  assert.equal(await down.data.text(), 'dxf text');
});

test('without R2 env the app keeps using Supabase Storage', async () => {
  const s = loadStorage(() => assert.fail('R2 must not be called'), { R2_BUCKET: '' });
  assert.equal(s.usingR2(), false);
  assert.deepEqual(plain(await s.bucket('robot-logs').info('x.wpilog')), { data: null, error: null });
  assert.deepEqual(plain(s.supabaseCalls), ['robot-logs']);
});
