// Team integration, appended to the pinned upstream module (X = sendMessage, W = hubPort).
// Accept only this window's same-origin parent, and never accept a remote log URL.
let mayhemReady = false;
const mayhemFiles = new Map();
function mayhemScopeReady() {
  mayhemReady = true;
  window.parent.postMessage({ type: 'team-scope-ready' }, location.origin);
}
async function mayhemScopeFetch(name, folder) {
  const data = mayhemFiles.get(name);
  if (data) {
    mayhemFiles.delete(name);
    return new Response(data);
  }
  return fetch(`logs/${encodeURIComponent(name)}?folder=${encodeURIComponent(folder)}`);
}
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== window.parent || window.parent === window) return;
  if (event.data?.type === 'team-scope-ping') {
    if (mayhemReady) mayhemScopeReady();
    return;
  }
  if (!mayhemReady || event.data?.type !== 'team-scope-open') return;
  const { bytes, name } = event.data;
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 250 * 1024 * 1024 || bytes.byteLength < 12 || typeof name !== 'string' || !name.toLowerCase().endsWith('.wpilog')) return;
  mayhemFiles.clear();
  const safeName = name.replace(/[\\/\x00-\x1f]/g, '_').slice(-180);
  mayhemFiles.set(safeName, bytes);
  X(W, 'open-files', { files: [safeName], merge: false });
  window.parent.postMessage({ type: 'team-scope-opened', name: safeName }, location.origin);
});
