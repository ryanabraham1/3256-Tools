import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const importDependency = createRequire(import.meta.url);
test('active issue views follow project archive, trash, and restoration', () => {
  const { activeWorkItems, filterIssues } = load('lib/work.ts');
  const row = (id, kind, data = {}, extra = {}) => ({ id, kind, title: id, data, archived: false, deleted_at: null, ...extra });
  const project = row('project', 'project');
  const issue = row('issue', 'issue', { project: project.id, assignee: 'me', status: 'Todo' });
  const unassigned = row('unassigned', 'issue');
  const archivedIssue = row('archived-issue', 'issue', {}, { archived: true });
  const deletedIssue = row('deleted-issue', 'issue', {}, { deleted_at: '2026-10-01' });
  const orphan = row('orphan', 'issue', { project: 'missing' });
  const others = [issue, unassigned, archivedIssue, deletedIssue, orphan];
  const ids = rows => Array.from(rows, i => i.id);
  for (const state of [{ archived: true }, { deleted_at: '2026-10-01' }]) {
    const items = [{ ...project, ...state }, ...others];
    assert.deepEqual(ids(filterIssues(items, {})), ['unassigned']);
    assert.deepEqual(ids(filterIssues(items, { project: project.id })), []);
    assert.deepEqual(ids(filterIssues(items, { assignee: 'me' })), []);
    assert.deepEqual(ids(activeWorkItems(items)), ['unassigned']);
  }
  assert.deepEqual(ids(filterIssues([project, ...others], {})), ['issue', 'unassigned']);
  assert.deepEqual(ids(filterIssues([project, ...others], { project: project.id })), ['issue']);
  assert.equal(issue.archived, false);
  assert.equal(issue.deleted_at, null);
});
function load(file, imports = {}, globals = {}) {
  const loadedModule = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module: loadedModule, exports: loadedModule.exports, require: name => imports[name] ?? importDependency(name), ...globals });
  return loadedModule.exports;
}
test('calendar dates retain their day in Los Angeles', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const { fmtDate } = load('lib/format.ts');
    assert.equal(fmtDate('2026-10-01'), 'Oct 1, 2026');
    assert.equal(fmtDate('2026-10-01T01:00:00Z'), 'Sep 30, 2026');
  } finally { process.env.TZ = previous; }
});
test('login return paths reject external URL forms', () => {
  const { safeReturnPath } = load('lib/navigation.ts');
  for (const value of ['//example.com', '/\\example.com', '/\n/example.com', 'https://example.com']) assert.equal(safeReturnPath(value), '/');
  assert.equal(safeReturnPath('/stock?q=hex'), '/stock?q=hex');
});
test('lengths reject zero and overflow while retaining shop notation', () => {
  const { parseLength } = load('lib/units.ts');
  for (const value of ["0'", '9'.repeat(320), '0.00001mm', '1/0']) assert.equal(parseLength(value, 'in'), null);
  assert.equal(parseLength('27 1/2', 'in'), 698.5);
  assert.equal(parseLength("2' 3\"", 'in'), 685.8);
  assert.equal(parseLength('70cm', 'in'), 700);
});
test('offline navigation never replaces a cached page with a login redirect', async () => {
  const listeners = {};
  const writes = [];
  let response = { ok: true, redirected: true, clone() { return this; } };
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
    self: { skipWaiting() {}, location: { origin: 'https://tools.test' }, addEventListener: (name, handler) => { listeners[name] = handler; } },
    URL, Response, setTimeout, clearTimeout,
    fetch: async () => response,
    caches: { open: async () => ({ put: (req, res) => writes.push(res), match: async () => null }) },
  });
  let installation;
  listeners.install({ waitUntil: p => { installation = p; } });
  await installation;
  assert.equal(writes.length, 0);
  const request = { method: 'GET', mode: 'navigate', url: 'https://tools.test/battery', headers: new Headers() };
  let result;
  listeners.fetch({ request, respondWith: p => { result = p; } });
  await result;
  assert.equal(writes.length, 0);
  response = { ...response, redirected: false };
  listeners.fetch({ request, respondWith: p => { result = p; } });
  await result;
  assert.equal(writes.length, 1);
});
test('replay retains changes enqueued while an action is in flight', async () => {
  let stored = JSON.stringify([{ id: 'old', name: 'addNote', batteryId: 'battery', fields: [], queuedAt: '' }]);
  const effects = [];
  let context;
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const calls = [];
  const actions = { addNote: async () => { calls.push('sent'); if (calls.length === 1) await first; return { ok: true }; } };
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useCallback: cb => cb, useMemo: cb => cb(), useRef: value => ({ current: value }),
    useState: value => [value, () => {}], useEffect: cb => effects.push(cb),
  };
  const { OfflineProvider } = load('components/offline.tsx', {
    react, 'react/jsx-runtime': { jsx: (type, props) => { context = props.value; return null; } },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/lib/offline-actions': { ACTIONS: actions, fromFields: () => new FormData(), toFields: fd => [...fd.entries()] },
  }, { localStorage: { getItem: () => stored, setItem: (key, value) => { stored = value; } },
    navigator: { onLine: true }, crypto: { randomUUID: () => 'new' }, FormData, setTimeout, clearTimeout });
  OfflineProvider({ children: null });
  effects[1](); // online effect starts the pending replay
  const result = await context.run('addNote', 'battery', new FormData());
  assert.equal(result.queued, true);
  assert.equal(calls.length, 1); // new change must wait for the old change
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(stored, '[]');
});

test('Google sessions refresh on every tool and preserve rotated cookies', async () => {
  const { NextRequest, NextResponse } = importDependency('next/server');
  const { WORK_COOKIE_OPTIONS } = load('lib/work-cookie.ts', {}, { process });
  assert.equal(WORK_COOKIE_OPTIONS.maxAge, 30 * 24 * 60 * 60);
  assert.equal(WORK_COOKIE_OPTIONS.httpOnly, true);
  assert.equal(WORK_COOKIE_OPTIONS.path, '/');
  for (const path of ['/', '/battery', '/stock', '/tracker', '/work', '/api/export/full']) {
    const request = new NextRequest(`https://tools.example${path}`, { headers: { cookie: 'sb-session=expired' } });
    const { refreshWorkSession } = load('lib/work-session.ts', {
      'next/server': { NextResponse },
      './work-cookie': { WORK_COOKIE_OPTIONS },
      '@supabase/ssr': { createServerClient: (_url, _key, options) => ({ auth: {
        getClaims: async () => {
          assert.equal(options.cookies.getAll()[0].value, 'expired');
          options.cookies.setAll([{ name: 'sb-session', value: 'rotated-refresh-token', options: { ...WORK_COOKIE_OPTIONS, maxAge: 400 * 24 * 60 * 60 } }]);
          return { data: { claims: { sub: 'google-user' } }, error: null };
        },
      } }) },
    }, { process });
    const response = await refreshWorkSession(request);
    assert.equal(response.status, 200, path);
    assert.equal(request.cookies.get('sb-session').value, 'rotated-refresh-token');
    assert.equal(response.cookies.get('sb-session').value, 'rotated-refresh-token');
    assert.equal(response.cookies.get('sb-session').maxAge, 30 * 24 * 60 * 60);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  }
});

test('signed-out requests preserve destinations, reject API calls, and ignore team-code cookies', async () => {
  const { NextRequest, NextResponse } = importDependency('next/server');
  const { refreshWorkSession } = load('lib/work-session.ts', {
    'next/server': { NextResponse },
    './work-cookie': { WORK_COOKIE_OPTIONS: {} },
    '@supabase/ssr': { createServerClient: (_url, _key, options) => ({ auth: {
      getClaims: async () => {
        options.cookies.setAll([{ name: 'sb-session', value: '', options: { maxAge: 0, path: '/' } }]);
        return { data: null, error: new Error('Expired session') };
      },
    } }) },
  }, { process, URL });
  const response = await refreshWorkSession(new NextRequest('https://tools.example/stock?pit=1', { headers: { cookie: 'bt_session=old-team-code' } }));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('Location')).searchParams.get('next'), '/stock?pit=1');
  assert.equal(response.cookies.get('sb-session').maxAge, 0);
  const api = await refreshWorkSession(new NextRequest('https://tools.example/api/export/full'));
  assert.equal(api.status, 401);
  assert.equal(api.cookies.get('sb-session').maxAge, 0);
  for (const path of ['/login', '/work/login', '/auth/work/callback', '/api/robot-logs', '/api/robot-logs/devices']) {
    assert.equal((await refreshWorkSession(new NextRequest(`https://tools.example${path}`))).status, 200);
  }
});

test('tool access requires an enabled linked Google account and viewers cannot write', async () => {
  const user = { id: 'google-id', email: 'user@example.com', email_confirmed_at: '2026-11-11', identities: [{ provider: 'google' }] };
  for (const role of ['admin', 'member', 'viewer']) {
    const filters = [];
    const accountQuery = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, single: async () => ({ data: { role, member_id: 'member-id' }, error: null }) };
    const { requireWorkUser } = load('lib/work-auth.ts', {
      'server-only': {}, react: { cache: fn => fn },
      'next/headers': { cookies: async () => ({ getAll: () => [] }) },
      './work-cookie': { WORK_COOKIE_OPTIONS: {} },
      './supabase': { supabaseAdmin: () => ({ from: () => accountQuery }) },
      '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
    }, { process });
    assert.equal((await requireWorkUser()).role, role);
    assert.ok(filters.some(([key, value]) => key === 'user_id' && value === user.id));
    assert.ok(filters.some(([key, value]) => key === 'disabled' && value === false));
    if (role === 'viewer') await assert.rejects(requireWorkUser(true), /view-only/);
    else assert.equal((await requireWorkUser(true)).role, role);
  }
  for (const deniedUser of [null, { ...user, email_confirmed_at: null }, { ...user, identities: [{ provider: 'email' }] }]) {
    const { isAuthed } = load('lib/auth.ts', {
      'server-only': {},
      './work-auth': load('lib/work-auth.ts', {
        'server-only': {}, react: { cache: fn => fn },
        'next/headers': { cookies: async () => ({ getAll: () => [] }) },
        './work-cookie': { WORK_COOKIE_OPTIONS: {} },
        './supabase': { supabaseAdmin: () => { throw new Error('Must not read data before identity verification'); } },
        '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: deniedUser }, error: null }) } }) },
      }, { process }),
    });
    assert.equal(await isAuthed(), false);
  }
});

test('sign-out revokes only this device and rejects cross-origin requests', async () => {
  const { NextResponse } = importDependency('next/server');
  const removed = [];
  const scopes = [];
  const { POST } = load('app/auth/work/sign-out/route.ts', {
    'next/server': { NextResponse },
    'next/headers': { cookies: async () => ({ delete: name => removed.push(name) }) },
    '@/lib/work-auth': { workAuthClient: async () => ({ auth: { signOut: async options => { scopes.push(options.scope); return { error: null }; } } }) },
  }, { URL });
  assert.equal((await POST(new Request('https://tools.example/auth/work/sign-out', { method: 'POST', headers: { origin: 'https://other.example' } }))).status, 403);
  assert.equal(scopes.length, 0);
  const response = await POST(new Request('https://tools.example/auth/work/sign-out', { method: 'POST', headers: { origin: 'https://tools.example' } }));
  assert.equal(response.status, 303);
  assert.deepEqual(scopes, ['local']);
  assert.deepEqual(removed, ['bt_session', 'bt_auth_next']);
});

test('real Supabase SSR client writes 30-day cookies and restores a session after restart', async () => {
  const { createServerClient } = importDependency('@supabase/ssr');
  const { WORK_COOKIE_OPTIONS } = load('lib/work-cookie.ts', {}, { process });
  const stored = new Map();
  const writes = [];
  const cookieJar = {
    getAll: () => [...stored].map(([name, value]) => ({ name, value })),
    set: (name, value, options) => {
      writes.push({ name, value, options });
      if (options.maxAge === 0) stored.delete(name);
      else stored.set(name, value);
    },
  };
  const now = Math.floor(Date.now() / 1000);
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'test-google-user', exp: now + 3600 })).toString('base64url')}.test-signature`;
  const user = { id: 'test-google-user', email: 'test@example.com', identities: [{ provider: 'google' }], email_confirmed_at: new Date().toISOString() };
  const session = { access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user };
  const fakeFetch = async url => {
    const path = new URL(url).pathname;
    assert.ok(path.endsWith('/verify') || path.endsWith('/user') || path.endsWith('/logout'), path);
    return new Response(JSON.stringify(path.endsWith('/user') ? user : session), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { workAuthClient } = load('lib/work-auth.ts', {
    'server-only': {}, react: { cache: fn => fn },
    'next/headers': { cookies: async () => cookieJar },
    './work-cookie': { WORK_COOKIE_OPTIONS },
    './supabase': {},
    '@supabase/ssr': { createServerClient: (_url, _key, options) => createServerClient('https://test.supabase.co', 'test-key', { ...options, global: { fetch: fakeFetch } }) },
  }, { process });
  const initial = await workAuthClient();
  const login = await initial.auth.verifyOtp({ token_hash: 'test-otp', type: 'email' });
  assert.equal(login.error, null);
  assert.ok(writes.length > 0);
  for (const cookie of writes.filter(c => c.value)) {
    assert.equal(cookie.options.maxAge, 30 * 24 * 60 * 60);
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.path, '/');
  }
  // A new server client has no in-memory login state; only persisted cookies survive.
  const restarted = await workAuthClient();
  const restored = await restarted.auth.getUser();
  assert.equal(restored.error, null);
  assert.equal(restored.data.user.id, user.id);
  const logout = await restarted.auth.signOut({ scope: 'local' });
  assert.equal(logout.error, null);
  assert.equal(stored.size, 0);
  assert.ok(writes.some(c => c.options.maxAge === 0));
});

test('Google callback returns to the selected tool and denies unapproved accounts', async () => {
  const { NextResponse } = importDependency('next/server');
  const { safeReturnPath } = load('lib/navigation.ts');
  for (const [destination, accessError, expectedPath] of [
    ['/stock?pit=1', null, '/stock?pit=1'],
    ['//outside.example', null, '/'],
    ['/tracker', { message: 'This email has not been granted workspace access.' }, '/login'],
  ]) {
    const removed = [], scopes = [], claimed = [];
    const { GET } = load('app/auth/work/callback/route.ts', {
      'next/server': { NextResponse },
      'next/headers': { cookies: async () => ({ get: () => ({ value: destination }), delete: name => removed.push(name) }) },
      '@/lib/navigation': { safeReturnPath },
      '@/lib/work-auth': { workAuthClient: async () => ({ auth: {
        exchangeCodeForSession: async code => { assert.equal(code, 'google-code'); return { error: null }; },
        getUser: async () => ({ data: { user: { id: 'google-id', email_confirmed_at: '2026-11-11', identities: [{ provider: 'google' }] } } }),
        signOut: async options => { scopes.push(options.scope); return { error: null }; },
      } }) },
      '@/lib/supabase': { supabaseAdmin: () => ({ rpc: async (name, args) => { claimed.push([name, args.auth_id]); return { error: accessError }; } }) },
    }, { URL, console });
    const response = await GET(new Request('https://tools.example/auth/work/callback?code=google-code'));
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin, 'https://tools.example');
    assert.equal(accessError ? location.pathname : location.pathname + location.search, expectedPath);
    assert.deepEqual(claimed, [['claim_work_account', 'google-id']]);
    assert.deepEqual(removed, ['bt_auth_next']);
    if (accessError) {
      assert.equal(location.searchParams.get('error'), 'access');
      assert.equal(location.searchParams.get('next'), '/tracker');
      assert.deepEqual(scopes, ['local']);
    }
  }
});
