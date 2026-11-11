import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('scope accepts only parent-origin byte handoffs after readiness, without uploading a local file', async () => {
  const origin = 'https://3256tools.vercel.app';
  const sent = [], opened = [], requests = [], listeners = {};
  const parent = { postMessage: value => sent.push(value) };
  const window = { parent, addEventListener: (type, handler) => listeners[type] = handler };
  const context = vm.createContext({ window, location: { origin }, ArrayBuffer, Response, Map, X: (...args) => opened.push(args), W: 'hub', fetch: url => { requests.push(url); return new Response('remote'); } });
  vm.runInContext(readFileSync('scripts/advantagescope-bridge.js', 'utf8'), context);
  const bytes = new ArrayBuffer(20);
  const receive = (source = parent, from = origin) => listeners.message({ source, origin: from, data: { type: 'team-scope-open', name: '../match.wpilog', bytes } });
  receive(); assert.equal(opened.length, 0);
  vm.runInContext('mayhemScopeReady()', context);
  receive({}, origin); receive(parent, 'https://evil.example'); assert.equal(opened.length, 0);
  receive(); assert.equal(opened.length, 1); assert.equal(opened[0][1], 'open-files');
  assert.equal(opened[0][2].files[0], '.._match.wpilog');
  const response = await vm.runInContext('mayhemScopeFetch(".._match.wpilog", "")', context);
  assert.equal((await response.arrayBuffer()).byteLength, 20);
  assert.equal(requests.length, 0);
  assert.equal(sent.at(-1).type, 'team-scope-opened');
});
