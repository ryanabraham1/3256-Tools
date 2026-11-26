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
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module: loadedModule, exports: loadedModule.exports, require: name => imports[name] ?? importDependency(name), ...globals });
  return loadedModule.exports;
}
test('COTS catalog matches screw and bearing dimensions and rejects conflicting hardware SKUs', async () => {
  const product = (sku, title, price, reference = true) => ({
    handle: sku.toLowerCase(), title, body_html: reference ? 'This Page is for Reference Only' : '',
    variants: [{ id: 1, sku, price, title: 'Default Title' }],
  });
  const products = [
    product('WCP-0906', '0.750" ID x 1.000" OD x 0.375" WD (Needle Bearing)', '3.49'),
    product('WCP-0100', '0.750" ID x 1.000" OD x 0.375" WD (Radial Bearing)', '4.00'),
    product('WCP-2243', '#10-32 x 1.250" L SHCS (Steel, Black Oxide) (50-Pack)', '5.99'),
    product('WCP-2249', '#8-32 x 1.000" L SHCS (Steel, Black Oxide) (50-Pack)', '5.99'),
    product('WCP-0102', '#8-32 x 1.500" L BHCS (Steel, Black Oxide) (50-Pack)', '7.00'),
    product('WCP-0103', '#8-32 x 1.500" L SHCS (Stainless Steel) (50-Pack)', '8.00', false),
  ];
  const { findVendorLink, cotsMaterial } = load('lib/vendors.ts', { 'server-only': {} }, {
    AbortSignal, fetch: async () => ({ ok: true, json: async () => ({ products }) }),
  });
  const lookup = (name, part_number = '', material_text = 'Steel') =>
    findVendorLink({ name, part_number, material_text, vendor: 'West Coast Products' });
  const bearing = await lookup('0.75" ID Needle Bearing (1" OD, 0.375" WD)');
  assert.equal(bearing.sku, 'WCP-0906');
  assert.equal(bearing.url, 'https://wcproducts.com/products/specialty-bearings');
  assert.equal(bearing.price, 3.49);
  assert.equal(await lookup('0.75" ID Needle Bearing (0.375" OD, 1" WD)'), null);
  const screwName = 'Socket head cap screw #10-32 × 1-1/4';
  const screw = await lookup(screwName + '-Mirrored');
  assert.equal(screw.sku, 'WCP-2243');
  assert.equal(screw.pack, 50);
  assert.equal(screw.url, 'https://wcproducts.com/products/socket-head-bolts');
  assert.equal(await lookup(screwName, 'WCP-2249'), null);
  assert.equal(await lookup('Socket head cap screw #8-32 × 1.5', 'WCP-2249'), null);
  assert.equal((await lookup('Socket head cap screw #8-32 × 1.5', '', 'Stainless Steel')).sku, 'WCP-0103');
  assert.equal(cotsMaterial({ name: screwName, part_number: 'WCP-2243' }, 'Stainless Steel'), 'Steel');
  assert.equal(cotsMaterial({ name: screwName, part_number: '' }, 'Stainless Steel'), 'Stainless Steel');
  assert.equal(cotsMaterial({ name: screwName, part_number: 'WCP-2249' }, 'Stainless Steel'), 'Stainless Steel');
});
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

test('admin page blocks non-admins before reading the team access list', async () => {
  for (const role of [null, 'viewer', 'member', 'admin']) {
    let reads = 0;
    const { default: AdminPage } = load('app/(app)/admin/page.tsx', {
      'next/link': { default: 'a' },
      'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
      '@/lib/work-auth': {
        getWorkUser: async () => role ? { role, email: 'test@example.com' } : null,
        getWorkAccess: async () => { reads++; return []; },
      },
      '@/components/work/access': { AccessPanel: () => null },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    });
    if (role === 'admin') {
      await AdminPage();
      assert.equal(reads, 1);
    } else {
      await assert.rejects(AdminPage(), /NOT_FOUND/);
      assert.equal(reads, 0);
    }
  }
});

test('saving work reads stored rows in one batch and hands back newer rows instead of a dead end', async () => {
  const id = n => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
  const stored = [1, 2, 3].map(n => ({ id: id(n), kind: 'issue', title: `Task ${n}`, revision: n, data: { status: 'Todo', source: { identifier: `WB-${n}`, raw: { big: true } } } }));
  const reads = [], calls = [];
  const db = {
    from: () => ({ select: columns => ({ in: async (_key, ids) => { reads.push([columns, ids]); return { data: stored.filter(r => ids.includes(r.id)), error: null }; } }) }),
    rpc: async (name, args) => { calls.push([name, args]); return { data: args.changes.map(c => { const row = stored.find(r => r.id === c.id); return { ...row, data: { ...row.data, ...c.data }, revision: c.revision + 1 }; }), error: null }; },
  };
  let revalidated = 0;
  const { mutateWork } = load('app/work-actions.ts', {
    'next/cache': { revalidatePath: () => { revalidated++; } },
    '@/lib/work-auth': { requireWorkUser: async () => ({ role: 'member', userId: 'google-id', memberId: 'member-id', name: 'Ryan' }) },
    '@/lib/supabase': { supabaseAdmin: () => db },
    '@/lib/work-snapshot': load('lib/work-snapshot.ts'),
    '@/lib/work': load('lib/work.ts'),
  }, { process, AbortSignal, fetch });

  const saved = await mutateWork(stored.map(r => ({ id: r.id, revision: r.revision, data: { status: 'Done' } })));
  assert.equal(saved.ok, true, saved.error);
  assert.equal(reads.length, 1, 'one read for the whole batch, not one per task');
  assert.deepEqual(Array.from(calls[0][1].changes, c => c.data.status), ['Done', 'Done', 'Done']);
  assert.equal(revalidated, 0, 'a save must not re-download the whole workspace');
  assert.equal(saved.items[0].data.source.raw, undefined);

  // A teammate saved first: nothing is written, and the newer row comes back so the browser can catch up.
  calls.length = 0;
  const stale = await mutateWork([{ id: id(1), revision: 1, data: { status: 'Done' } }, { id: id(2), revision: 1, data: { status: 'Done' } }]);
  assert.equal(stale.ok, false);
  assert.deepEqual(Array.from(stale.current, r => [r.id, r.revision]), [[id(2), 2]]);
  assert.equal(stale.current[0].data.source.raw, undefined);
  assert.equal(calls.length, 0);

  for (const bad of [[{ id: 'not-a-uuid', revision: 1 }], [{ id: id(9), revision: 1 }], []]) assert.equal((await mutateWork(bad)).ok, false);
  assert.equal(calls.length, 0);
});

test('the Work save endpoint only accepts same-origin requests and passes changes to the checked save', async () => {
  const seen = [];
  const { POST } = load('app/api/work/save/route.ts', {
    '@/app/work-actions': { mutateWork: async changes => { seen.push(changes); return { ok: true, items: [] }; } },
  }, { URL, Response });
  const post = (origin, body) => POST(new Request('https://tools.example/api/work/save', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body }));
  assert.equal((await post('https://other.example', '{"changes":[]}')).status, 403);
  assert.equal((await post('https://tools.example', 'not json')).status, 400);
  assert.equal(seen.length, 0);
  const saved = await post('https://tools.example', JSON.stringify({ changes: [{ id: 'a', data: { status: 'Done' } }] }));
  assert.equal(saved.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await saved.json(), { ok: true, items: [] });
  assert.equal(seen[0][0].data.status, 'Done');
});

function fabActionFixture({ design, parts = [], respond, vendors }) {
  const paths = [];
  const writes = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const onshape = load('lib/onshape.ts', { 'server-only': {} }, {
    AbortSignal, Buffer, URLSearchParams, process: { env: {} },
    fetch: async (url) => {
      const request = new URL(url);
      paths.push(request.pathname + request.search);
      return respond(request, json);
    },
  });
  const data = {
    fab_designs: [{ name: "Fixture assembly", ...design }],
    fab_parts: parts,
    fab_part_events: [],
  };
  const db = {
    from(table) {
      const matches = [];
      let patch;
      let insert;
      return {
        select() { return this; },
        eq(key, value) { matches.push((row) => row[key] === value); return this; },
        is(key, value) { return this.eq(key, value); },
        single() { return this.then(({ data }) => ({ data: data[0], error: null })); },
        update(row) { patch = row; return this; },
        insert(row) { insert = row; return this; },
        then(resolve) {
          const rows = data[table].filter((row) => matches.every((match) => match(row)));
          if (patch) {
            writes.push([table, patch]);
            for (const row of rows) Object.assign(row, patch);
          }
          if (insert) {
            writes.push([table, insert]);
            const row = { id: String(data[table].length + 1), ...insert };
            data[table].push(row);
            return resolve({ data: [row], error: null });
          }
          return resolve({ data: rows, error: null });
        },
      };
    },
  };
  const tracker = load('lib/tracker.ts');
  const partsLib = load('lib/parts.ts', { './units': load('lib/units.ts') });
  const actions = load('app/parts-actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/supabase': { supabaseAdmin: () => db },
    '@/lib/work-auth': { requireWorkUser: async () => ({ userId: 'fixture-user' }) },
    '@/lib/fab-data': { getMaterials: async () => [] },
    '@/lib/parts-data': { toPart: (p) => p, getPerson: async () => 'Fixture', getPartsSettings: async () => partsLib.DEFAULT_PARTS_SETTINGS },
    '@/app/fab-actions': {},
    '@/lib/parts': partsLib,
    '@/lib/tracker': tracker,
    '@/lib/onshape': onshape,
    '@/lib/onshape-keys': { getOnshapeKeys: async () => ({ access: 'fixture', secret: 'fixture' }) },
    '@/lib/dfm': {},
    '@/lib/parts-match': {},
    '@/lib/part-twins': load('lib/part-twins.ts', { './tracker': tracker }),
    '@/lib/vendors': vendors ?? load('lib/vendors.ts', { 'server-only': {} }),
    '@/lib/fab': {},
    '@/lib/nest': {},
    '@/lib/geom': {},
    '@/lib/units': {},
  });
  return { actions, paths, writes };
}

const fabForm = (fields) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
};

test('COTS lookup fills missing ordering details only for the saved product link', async () => {
  const url = 'https://wcproducts.com/products/specialty-bearings';
  const hit = { url, vendor: 'West Coast Products', sku: 'WCP-0906', price: 3.49, pack: 1 };
  const parts = ['', url, 'https://another.example/part'].map((savedURL, i) => ({
    id: String(i), kind: 'cots', missing: false, name: 'Needle Bearing', url: savedURL,
    vendor: '', part_number: '', material_text: '', unit_price: null, pack_size: null,
  }));
  const { actions } = fabActionFixture({ parts, vendors: { findVendorLink: async () => hit } });
  const result = await actions.findCotsLinks(fabForm({}));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(parts.map((p) => [p.url, p.part_number, p.unit_price]), [
    [url, 'WCP-0906', 3.49],
    [url, 'WCP-0906', 3.49],
    ['https://another.example/part', '', null],
  ]);
});

test('Onshape sync batches default studios, falls back for missing metadata, and reads geometry only where needed', async () => {
  const design = { id: 'design', document_id: 'doc', wvm: 'w', wvm_id: 'workspace', element_id: 'assembly', element_type: 'assembly' };
  function line(eid, name, configuration = 'default') {
    return {
      headerIdToValue: { name, material: 'Plastic' },
      itemSource: { documentId: 'doc', elementId: eid, partId: 'part', wvmType: 'workspace', wvmId: 'workspace', fullConfiguration: configuration },
    };
  }
  function metadata(process) {
    return { items: [{ partId: 'part', properties: [{ name: 'Process', value: process }] }] };
  }
  const { actions, paths, writes } = fabActionFixture({
    design,
    respond(request, json) {
      const route = request.pathname;
      if (route.endsWith('/bom')) return json({
        headers: [{ id: 'name', name: 'Name' }, { id: 'material', name: 'Material' }],
        rows: [line('bought', 'Bearing'), line('reference', 'Origin cube'), line('incomplete', 'Mount'), line('configured', 'Spacer', 'size=large')],
      });
      if (route.endsWith('/workspace/e')) return json({
        items: [
          { elementId: 'bought', parts: metadata('COTS') },
          { elementId: 'reference', parts: metadata('Machined') },
          { elementId: 'incomplete', parts: { items: [] } },
        ],
      });
      if (route.endsWith('/incomplete/p')) return json(metadata('3D Print'));
      if (route.endsWith('/configured/p')) {
        assert.equal(request.searchParams.get('configuration'), 'size=large');
        return json(metadata('Machined'));
      }
      if (route.endsWith('/bodydetails')) return json({ bodies: [] });
      return json({}, 500);
    },
  });
  const result = await actions.syncDesign(fabForm({ id: design.id }));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(paths.map((p) => p.split('?')[0]).sort(), [
    '/api/v10/assemblies/d/doc/w/workspace/e/assembly/bom',
    '/api/v10/metadata/d/doc/w/workspace/e',
    '/api/v10/metadata/d/doc/w/workspace/e/configured/p',
    '/api/v10/metadata/d/doc/w/workspace/e/incomplete/p',
    '/api/v10/partstudios/d/doc/w/workspace/e/configured/bodydetails',
    '/api/v10/partstudios/d/doc/w/workspace/e/incomplete/bodydetails',
  ]);
  assert.deepEqual(writes.filter(([table]) => table === 'fab_parts').map(([, p]) => p.kind).sort(), ['cots', 'machined', 'print']);
});

test('Onshape quota errors stop sync before it can change the tracker', async () => {
  const design = { id: 'design', document_id: 'doc', wvm: 'w', wvm_id: 'workspace', element_id: 'assembly', element_type: 'assembly' };
  const { actions, paths, writes } = fabActionFixture({
    design,
    respond(request, json) {
      if (request.pathname.endsWith('/bom')) return json({
        headers: [{ id: 'name', name: 'Name' }],
        rows: ['one', 'two'].map((eid) => ({
          headerIdToValue: { name: 'Bracket' },
          itemSource: { documentId: 'doc', elementId: eid, partId: 'part', wvmId: 'workspace' },
        })),
      });
      return json({}, 429);
    },
  });
  const result = await actions.syncDesign(fabForm({ id: design.id }));
  assert.equal(result.ok, false);
  assert.match(result.error, /429/);
  assert.equal(paths.length, 2);
  assert.deepEqual(writes, []);
});

test('moving a tracker part keeps its identity and only resets an incompatible status', async () => {
  const record = { id: 'original', name: 'Bracket', kind: 'machined', status: 'have_cam', source: {}, notes: 'Keep these' };
  const { actions, writes } = fabActionFixture({ design: {}, parts: [record] });
  const toPrint = await actions.updatePart(fabForm({ id: record.id, kind: 'print' }));
  assert.equal(toPrint.ok, true, toPrint.error);
  assert.equal(record.kind, 'print');
  assert.equal(record.status, 'not_started');
  record.status = 'in_progress';
  const toMachining = await actions.updatePart(fabForm({ id: record.id, kind: 'tube' }));
  assert.equal(toMachining.ok, true, toMachining.error);
  assert.equal(record.kind, 'tube');
  assert.equal(record.status, 'in_progress');
  assert.equal(record.id, 'original');
  assert.equal(record.notes, 'Keep these');
  const partWrites = writes.filter(([table]) => table === 'fab_parts');
  assert.equal(partWrites.length, 2);
  assert.equal('status' in partWrites[1][1], false);
});
