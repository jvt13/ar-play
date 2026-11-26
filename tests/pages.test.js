import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const base = new URL('https://example.github.io/ar-play/');

function localReference(reference, parent = base) {
  const url = new URL(reference, parent);
  assert.equal(url.origin, base.origin, `External resource: ${reference}`);
  assert.ok(url.pathname.startsWith(base.pathname), `Escapes subdirectory: ${reference}`);
  const relative = url.pathname.slice(base.pathname.length) || 'index.html';
  assert.ok(existsSync(new URL(relative, root)), `Missing resource: ${relative}`);
  return url;
}

test('manifest, HTML, CSS and ES modules resolve inside /ar-play/', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(new URL(manifest.start_url, base).href, base.href);
  assert.equal(new URL(manifest.scope, base).href, base.href);
  assert.equal(new URL(manifest.id, base).href, base.href);
  for (const icon of manifest.icons) {
    localReference(icon.src);
    const png = readFileSync(new URL(icon.src, root));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
    assert.equal(icon.type, 'image/png');
  }
  for (const match of read('index.html').matchAll(/(?:src|href)="([^"]+)"/g)) localReference(match[1]);
  for (const match of read('style.css').matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) localReference(match[1]);
  for (const name of ['body-profiles', 'app', 'engine', 'math', 'depth', 'spatial-map', 'collision', 'movement-probe', 'volume', 'spatial-debug', 'revalidation', 'diagnostics']) {
    const parent = new URL(`src/${name}.js`, base);
    for (const match of read(`src/${name}.js`).matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) localReference(match[1], parent);
  }
  // Registration resolves against the document, not the src/ module directory.
  assert.match(read('src/app.js'), /serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.equal(new URL('./sw.js', base).pathname, '/ar-play/sw.js');
  for (const file of ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js', 'src/body-profiles.js', 'src/app.js', 'src/depth.js', 'src/spatial-map.js', 'src/collision.js', 'src/movement-probe.js', 'src/volume.js', 'src/spatial-debug.js', 'src/revalidation.js', 'src/diagnostics.js', 'src/engine.js', 'src/math.js']) {
    assert.doesNotMatch(read(file), /http:\/\//, `Mixed content in ${file}`);
  }
});

test('service worker precaches public resources, removes obsolete caches and serves offline', async () => {
  const handlers = {}, stored = new Map(), removed = [];
  let opened, skipped = false, claimed = false, networkFails = false;
  const version = JSON.parse(read('package.json')).version;
  const current = /const CACHE='([^']+)'/.exec(read('sw.js'))[1];
  assert.match(current, new RegExp(`^ar-play-v${version.replaceAll('.', '\\.')}(-r[1-9][0-9]*)?$`));
  const context = {
    URL,
    self: {
      location: {origin: base.origin},
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: () => { skipped = true; },
      clients: {claim: () => { claimed = true; }},
    },
    caches: {
      open: async name => {
        opened = name;
        return {addAll: async files => {
          for (const file of files) {
            const url = localReference(file);
            stored.set(url.href, {url: url.href, cached: true});
          }
        }};
      },
      keys: async () => ['ar-play-v1.0.0', 'ar-play-v1.0.1', 'ar-play-v1.0.2', 'ar-play-v1.1.0', 'ar-play-v1.1.1', 'ar-play-v1.1.2', 'ar-play-v1.1.3', 'ar-play-v1.1.3-r2', 'ar-play-v1.1.4', 'ar-play-v1.1.5', current, 'another-app-cache'],
      delete: async name => { removed.push(name); return true; },
      match: async request => stored.get(new URL(typeof request === 'string' ? request : request.url, base).href),
    },
    fetch: async request => {
      if (networkFails) throw Error('offline');
      return {url: request.url, network: true};
    },
  };
  vm.runInNewContext(read('sw.js'), context);
  async function lifecycle(name) {
    let done;
    handlers[name]({waitUntil: promise => { done = promise; }});
    await done;
  }
  await lifecycle('install');
  assert.equal(opened, current);
  assert.ok(skipped);
  assert.equal(stored.size, 18);
  await lifecycle('activate');
  assert.deepEqual(removed, ['ar-play-v1.0.0', 'ar-play-v1.0.1', 'ar-play-v1.0.2', 'ar-play-v1.1.0', 'ar-play-v1.1.1', 'ar-play-v1.1.2', 'ar-play-v1.1.3', 'ar-play-v1.1.3-r2', 'ar-play-v1.1.4', 'ar-play-v1.1.5']);
  assert.ok(claimed);
  const request = (file, mode = 'cors', method = 'GET') => ({url: new URL(file, base).href, mode, method});
  async function response(req) {
    let result;
    handlers.fetch({request: req, respondWith: promise => { result = promise; }});
    return result;
  }
  assert.ok((await response(request('./', 'navigate'))).network);
  networkFails = true;
  assert.equal((await response(request('./?test=1', 'navigate'))).url, new URL('index.html', base).href);
  for (const file of ['style.css', 'src/body-profiles.js', 'src/app.js', 'src/depth.js', 'src/spatial-map.js', 'src/collision.js', 'src/movement-probe.js', 'src/volume.js', 'src/spatial-debug.js', 'src/revalidation.js', 'src/diagnostics.js', 'src/engine.js', 'src/math.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']) {
    assert.ok((await response(request(file))).cached, `Offline resource missing: ${file}`);
  }
  assert.equal(await response(request('./', 'cors', 'POST')), undefined);
  assert.equal(await response({url: 'https://other.example/file.js', method: 'GET'}), undefined);
});
