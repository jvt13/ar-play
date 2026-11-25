// Browser-only TEST FIXTURE. No physical XR/depth measurements. Never shipped in the site.
(() => {
  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const test = window.__xrTest = {scenario: 'granted', reads: 0, requests: [], active: false};
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.textContent = 'TESTE SIMULADO — sem medição física';
    banner.style.cssText = 'position:fixed;bottom:0;right:0;background:#6b1730;color:white;font:10px sans-serif;padding:3px;z-index:1000;pointer-events:none';
    document.body.append(banner);
  });
  const data = new Uint16Array(64).fill(2000).buffer;
  class FakeFrame {
    constructor(session) { this.session = session; }
    getViewerPose() { return {transform: {matrix: I}, views: [{projectionMatrix: I, transform: {inverse: {matrix: I}}}]}; }
    getHitTestResults() { return []; }
    getDepthInformation() {
      if (!test.active) throw new DOMException('Inactive synthetic frame', 'InvalidStateError');
      test.reads++;
      if (test.scenario === 'missing') return null;
      if (test.scenario === 'error') throw new DOMException('Synthetic read failure', 'InvalidStateError');
      return {
        width: 8, height: 8, rawValueToMeters: .001, normDepthBufferFromNormView: {matrix: I},
        get data() {
          if (!test.active) throw new DOMException('Inactive synthetic depth buffer', 'InvalidStateError');
          return data;
        },
      };
    }
  }
  window.XRFrame = FakeFrame;
  window.XRWebGLLayer = class {
    constructor(_session, gl) { this.framebuffer = null; this.framebufferWidth = gl.canvas.width; this.framebufferHeight = gl.canvas.height; }
    getViewport() { return {x: 0, y: 0, width: this.framebufferWidth, height: this.framebufferHeight}; }
  };
  WebGLRenderingContext.prototype.makeXRCompatible = async () => {};
  Object.defineProperty(navigator, 'xr', {configurable: true, value: {
    requestSession: async (_mode, options) => {
      test.requests.push(!!options.depthSensing);
      if (test.scenario === 'reject-option' && options.depthSensing) throw new TypeError('Synthetic old browser');
      const granted = test.scenario !== 'denied' && test.scenario !== 'unsupported' && !!options.depthSensing;
      const handlers = {};
      const session = {
        enabledFeatures: granted ? ['hit-test', 'dom-overlay', 'depth-sensing'] : ['hit-test', 'dom-overlay'],
        get depthUsage() { if (!granted) throw new DOMException('Not granted', 'InvalidStateError'); return 'cpu-optimized'; },
        get depthDataFormat() { if (!granted) throw new DOMException('Not granted', 'InvalidStateError'); return 'luminance-alpha'; },
        addEventListener: (name, callback) => { handlers[name] = callback; },
        updateRenderState(state) { this.renderState = state; },
        requestReferenceSpace: async () => ({}),
        requestHitTestSource: async () => ({cancel() {}}),
        requestAnimationFrame(callback) {
          requestAnimationFrame(time => {
            if (this.ended) return;
            test.active = true;
            try { callback(time, new FakeFrame(this)); } finally { test.active = false; }
          });
        },
        async end() { this.ended = true; handlers.end?.(); },
      };
      return session;
    },
  }});
})();
