/** Pinned upstream binary; no build of a replacement viewer. See docs/ADVANTAGESCOPE.md. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const version = 'v27.0.0-alpha-6';
const digest = '2836019cd1f31be79459df1c83eb2cb26a3fe5dbd3f5820a898c2fe2acc98890';
const target = path.resolve('public/advantagescope');
const bridge = await readFile('scripts/advantagescope-bridge.js', 'utf8');
const stamp = version + ':' + createHash('sha256').update(bridge).update(await readFile(new URL(import.meta.url))).digest('hex');
if (await readFile(path.join(target, '.version'), 'utf8').catch(() => '') === stamp) process.exit(0);
const temp = await mkdtemp(path.join(tmpdir(), 'team-advantagescope-'));
try {
  const local = process.env.ADVANTAGESCOPE_IPK;
  const archive = local ? await readFile(local) : Buffer.from(await (await fetch(`https://github.com/Mechanical-Advantage/AdvantageScope/releases/download/${version}/advantagescope-lite-${version}.ipk`)).arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== digest) throw new Error('AdvantageScope artifact checksum mismatch');
  if (archive.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('Invalid package');
  let data;
  for (let offset = 8; offset < archive.length;) {
    const header = archive.subarray(offset, offset + 60);
    const size = Number(header.subarray(48, 58).toString().trim());
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid archive size');
    if (header.subarray(0, 16).toString().trim().replace(/\/$/, '') === 'data.tar.gz') data = archive.subarray(offset + 60, offset + 60 + size);
    offset += 60 + size + size % 2;
  }
  if (!data) throw new Error('Missing package data');
  await writeFile(path.join(temp, 'data.tar.gz'), data);
  execFileSync('tar', ['xzf', path.join(temp, 'data.tar.gz'), '-C', temp]);
  const root = path.join(temp, 'usr/local/bin/advantagescope-lite');
  await rm(target, { recursive: true, force: true });
  await cp(path.join(root, 'static'), target, { recursive: true });
  for (const file of ['LICENSE', 'ThirdPartyLicenses.txt']) await cp(path.join(root, file), path.join(target, file));
  // Python's on-robot asset index is replaced by equivalent static JSON.
  const index = {};
  async function visit(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const key = prefix + entry.name, full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full, key + '/');
      else index[key] = key.endsWith('config.json') ? JSON.parse(await readFile(full, 'utf8')) : null;
    }
  }
  await visit(path.join(target, 'bundledAssets'));
  await writeFile(path.join(target, 'asset-index.json'), JSON.stringify(index));
  await cp(path.join(target, 'bundledAssets'), path.join(target, 'assets'), { recursive: true });
  await rm(path.join(target, 'bundledAssets'), { recursive: true });
  let main = await readFile(path.join(target, 'bundles/main.js'), 'utf8');
  function replaceOnce(before, after) {
    if (main.split(before).length !== 2) throw new Error('Upstream bridge anchor changed: ' + before);
    main = main.replace(before, after);
  }
  replaceOnce('window.location.pathname', '"/advantagescope/"');
  replaceOnce('X(W,`show-when-ready`)', 'X(W,`show-when-ready`),mayhemScopeReady()');
  replaceOnce('fetch(`logs/${encodeURIComponent(n)}?folder=${encodeURIComponent(r.remotePath)}`)', 'mayhemScopeFetch(n,r.remotePath)');
  await writeFile(path.join(target, 'bundles/main.js'), main + '\n' + bridge);
  // The release expects a slash-terminated base, supplied by index.html + <base>.
  const html = await readFile(path.join(target, 'index.html'), 'utf8');
  await writeFile(path.join(target, 'index.html'), html.replace('<head>', '<head><base href="/advantagescope/">'));
  await writeFile(path.join(target, '.version'), stamp);
  console.log('Prepared official AdvantageScope Lite ' + version);
} finally { await rm(temp, { recursive: true, force: true }); }
