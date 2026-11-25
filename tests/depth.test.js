import test from 'node:test';
import assert from 'node:assert/strict';
import {createDepthReader, DepthDiagnostics, requestDepthSession} from '../src/depth.js';

// All depth/session fixtures in this file are synthetic, never physical measurements.
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function info(values = [2000, 2000, 2000, 2000], Type = Uint16Array, width = 2, height = 2) {
  return {width, height, rawValueToMeters: .001, normDepthBufferFromNormView: {matrix: identity()}, data: new Type(values).buffer};
}
const granted = () => ({enabledFeatures: ['hit-test', 'dom-overlay', 'depth-sensing'], depthUsage: 'cpu-optimized', depthDataFormat: 'luminance-alpha'});

for (const format of ['luminance-alpha', 'unsigned-short', 'float32']) {
  test(`depth raw conversion to meters: ${format} (simulated)`, () => {
    const data = info([0x1234, 0, 2000, 4000], format === 'float32' ? Float32Array : Uint16Array);
    const read = createDepthReader(data, format);
    assert.equal(read.at(0, 0), 4.66);
    assert.equal(read.at(1, 0), null);
    assert.equal(read.at(0, 1), 2);
    assert.equal(read.at(1, 1), 4);
  });
}

test('depth rejects invalid pixels, coordinates and metadata (simulated)', () => {
  const data = info([0, -1, NaN, Infinity, 2500], Float32Array, 5, 1);
  const read = createDepthReader(data, 'float32');
  for (let i = 0; i < 4; i++) assert.equal(read.at((i + .5) / 5, .5), null);
  assert.equal(read.at(.9, .5), 2.5);
  for (const point of [[-1, .5], [2, .5], [NaN, .5], [.5, Infinity]]) assert.equal(read.at(...point), null);
  for (const change of [{width: 0}, {height: 1.5}, {rawValueToMeters: 0}, {rawValueToMeters: NaN}, {data: undefined}, {data: new ArrayBuffer(1)}, {normDepthBufferFromNormView: null}]) {
    assert.throws(() => createDepthReader({...info(), ...change}, 'luminance-alpha'));
  }
  assert.throws(() => createDepthReader(info(), 'unknown-format'));
  const invalidMatrix = info(); invalidMatrix.normDepthBufferFromNormView.matrix[4] = NaN;
  assert.throws(() => createDepthReader(invalidMatrix, 'luminance-alpha'));
});

test('depth view-to-buffer transform handles crop, rotation, flips and edge clamping (simulated)', () => {
  const data = info([1, 2, 3, 4, 5, 6, 7, 8], Uint16Array, 4, 2);
  data.rawValueToMeters = 1;
  assert.equal(createDepthReader(data, 'luminance-alpha').at(.5, .5), 7);
  let m = data.normDepthBufferFromNormView.matrix;
  m[0] = -1; m[12] = 1;
  assert.equal(createDepthReader(data, 'luminance-alpha').at(.125, .25), 4);
  m.set(identity()); m[0] = 0; m[4] = 1; m[1] = -1; m[5] = 0; m[13] = 1;
  assert.equal(createDepthReader(data, 'luminance-alpha').at(.125, .25), 6);
  m.set(identity()); m[0] = .5; m[5] = .5; m[12] = .5;
  assert.equal(createDepthReader(data, 'luminance-alpha').at(0, .5), 3);
  m[12] = 3;
  assert.equal(createDepthReader(data, 'luminance-alpha').at(.5, .5), 4);
  m[15] = 0;
  assert.equal(createDepthReader(data, 'luminance-alpha').at(.5, .5), null);
});

test('depth negotiation is optional, requests CPU and preserves base AR features (simulated)', async () => {
  const base = {requiredFeatures: ['hit-test', 'dom-overlay'], optionalFeatures: ['anchors'], domOverlay: {root: {}}};
  let received;
  const session = granted();
  const result = await requestDepthSession({requestSession: async (mode, options) => { assert.equal(mode, 'immersive-ar'); received = options; return session; }}, base);
  assert.equal(result.session, session);
  assert.equal(result.fallback, false);
  assert.deepEqual(received.requiredFeatures, ['hit-test', 'dom-overlay']);
  assert.deepEqual(received.optionalFeatures, ['anchors', 'depth-sensing']);
  assert.deepEqual(received.depthSensing, {usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32']});
  assert.equal(received.domOverlay, base.domOverlay);
  assert.deepEqual(base.optionalFeatures, ['anchors']);
  assert.equal(base.depthSensing, undefined);
});

test('depth negotiation retries incompatible extensions without depth, but never retries permissions (simulated)', async () => {
  const base = {requiredFeatures: ['hit-test', 'dom-overlay']};
  for (const name of ['NotSupportedError', 'TypeError']) {
    let calls = 0;
    const result = await requestDepthSession({requestSession: async (_mode, options) => {
      if (++calls === 1) throw Object.assign(new Error(), {name});
      assert.equal(options, base);
      return granted();
    }}, base);
    assert.equal(calls, 2); assert.equal(result.fallback, true);
  }
  for (const name of ['NotAllowedError', 'SecurityError', 'AbortError']) {
    let calls = 0;
    await assert.rejects(requestDepthSession({requestSession: async () => { calls++; throw Object.assign(new Error(), {name}); }}, base), {name});
    assert.equal(calls, 1);
  }
});

test('depth distinguishes browser API absence from optional feature not granted (simulated)', () => {
  const monitor = new DepthDiagnostics();
  monitor.start(granted(), {apiAvailable: false}); monitor.setEnabled(true);
  assert.equal(monitor.snapshot().status, 'unsupported');
  const denied = {enabledFeatures: ['hit-test'], get depthUsage() { throw new Error('must not access denied getters'); }};
  monitor.start(denied, {apiAvailable: true}); monitor.setEnabled(true);
  assert.equal(monitor.snapshot().status, 'not-granted');
  const legacyDenied = {get depthUsage() { throw Object.assign(new Error(), {name: 'InvalidStateError'}); }};
  monitor.start(legacyDenied, {apiAvailable: true}); monitor.setEnabled(true);
  assert.equal(monitor.snapshot().status, 'not-granted');
  const legacyGranted = {...granted(), enabledFeatures: undefined};
  monitor.start(legacyGranted, {apiAvailable: true}); monitor.setEnabled(true);
  assert.equal(monitor.snapshot().status, 'waiting');
  monitor.start({...granted(), depthDataFormat: 'unknown'}, {apiAvailable: true}); monitor.setEnabled(true);
  assert.equal(monitor.snapshot().status, 'error');
});

test('depth samples only while enabled and inside the active frame, throttles and clears resources (simulated)', () => {
  let reads = 0, images = 0, paints = 0, active = false;
  const context = {clearRect() {}, createImageData: (w, h) => { images++; return {data: new Uint8ClampedArray(w * h * 4)}; }, putImageData: () => { paints++; }};
  const attributes = {};
  const elements = {button: {setAttribute: (k, v) => { attributes[k] = v; }}, panel: {}, readout: {}, mapToggle: {}, mapCanvas: {getContext: () => context}};
  const monitor = new DepthDiagnostics(elements, () => 0), session = granted(), view = {};
  const buffer = info();
  const original = buffer.data;
  Object.defineProperty(buffer, 'data', {get() { assert.ok(active, 'data accessed outside XRFrame'); return original; }});
  const frame = {session, getDepthInformation: received => { assert.ok(active); assert.equal(received, view); reads++; return buffer; }};
  const update = time => { active = true; monitor.update(time, frame, view); active = false; };
  monitor.start(session, {apiAvailable: true});
  update(0); assert.equal(reads, 0); assert.equal(elements.panel.hidden, true);
  elements.button.onclick(); assert.equal(elements.panel.hidden, false); assert.equal(attributes['aria-expanded'], 'true');
  update(10); assert.equal(reads, 1); assert.equal(images, 0);
  assert.equal(monitor.snapshot().center, 2); assert.equal(monitor.snapshot().valid, 64);
  update(26); assert.equal(reads, 1); assert.ok(monitor.snapshot().fps > 0);
  elements.mapToggle.checked = true; elements.mapToggle.onchange(); update(42);
  assert.equal(images, 1); assert.equal(paints, 1); assert.equal(monitor.snapshot().total, 768); assert.equal(elements.mapCanvas.hidden, false);
  const image = monitor.image; update(300); assert.equal(monitor.image, image); assert.equal(images, 1);
  elements.button.onclick(); assert.equal(monitor.snapshot().center, null); assert.equal(elements.panel.hidden, true);
  assert.equal(elements.mapCanvas.hidden, true); assert.equal(elements.mapToggle.checked, false);
  update(600); assert.equal(reads, 3);
  monitor.setEnabled(true); update(700); assert.equal(reads, 4);
  monitor.stop(); assert.equal(monitor.session, null); assert.equal(monitor.context, null); assert.equal(monitor.image, null);
  assert.equal(monitor.snapshot().width, null); assert.equal(monitor.snapshot().center, null); assert.equal(monitor.snapshot().enabled, false);
  update(1000); assert.equal(reads, 4);
  assert.equal(elements.readout.textContent, '');
});

test('depth clears stale readings for missing/invalid data, handles read errors and recovers (simulated)', () => {
  const monitor = new DepthDiagnostics({}, () => 0), session = granted();
  let next = info(), failure = false;
  const frame = {session, getDepthInformation: () => { if (failure) throw new Error('synthetic failure'); return next; }};
  monitor.start(session, {apiAvailable: true}); monitor.setEnabled(true);
  monitor.update(0, frame, {}); assert.equal(monitor.snapshot().status, 'available');
  next = null; monitor.update(250, frame, {});
  assert.equal(monitor.snapshot().status, 'waiting'); assert.equal(monitor.snapshot().center, null);
  next = info([0, 0, 0, 0]); monitor.update(500, frame, {});
  assert.equal(monitor.snapshot().status, 'waiting'); assert.equal(monitor.snapshot().valid, 0);
  failure = true; monitor.update(750, frame, {});
  assert.equal(monitor.snapshot().status, 'error'); assert.equal(monitor.snapshot().center, null);
  failure = false; next = info(); monitor.update(1000, frame, {});
  assert.equal(monitor.snapshot().status, 'available'); assert.equal(monitor.snapshot().center, 2);
  monitor.update(1250, frame, undefined); assert.equal(monitor.snapshot().center, null);
  next = {...info(), data: new ArrayBuffer(1)}; monitor.update(1500, frame, {});
  assert.equal(monitor.snapshot().status, 'error'); assert.equal(monitor.snapshot().center, null);
});

test('depth reduces sampling to 1 Hz after expensive reads, without polling while disabled (simulated)', () => {
  let clock = 0, reads = 0;
  const monitor = new DepthDiagnostics({}, () => { clock += 12; return clock; }), session = granted();
  const frame = {session, getDepthInformation: () => { reads++; return info(); }};
  monitor.start(session, {apiAvailable: true}); monitor.setEnabled(true);
  monitor.update(0, frame, {}); assert.equal(monitor.snapshot().interval, 1000);
  monitor.update(250, frame, {}); assert.equal(reads, 1);
  monitor.update(1000, frame, {}); assert.equal(reads, 2);
  monitor.setEnabled(false); monitor.update(2000, frame, {}); assert.equal(reads, 2);
});
