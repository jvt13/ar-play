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
  const detailedData = new Uint16Array(160 * 90).fill(2000).buffer;
  let previousDepth=2;
  const P = new Float32Array([1.3,0,0,0,0,1.3,0,0,0,0,-1.01,-1,0,0,-.1,0]);
  const camera = new Float32Array(I); camera[13] = .35;
  const cameraInverse = new Float32Array(I); cameraInverse[13] = -.35;
  class FakeFrame {
    constructor(session) { this.session = session; }
    getViewerPose() { const angle=test.cameraYaw??0,c=Math.cos(angle),s=Math.sin(angle);camera[0]=camera[10]=c;camera[2]=-s;camera[8]=s;cameraInverse[0]=cameraInverse[10]=c;cameraInverse[2]=s;cameraInverse[8]=-s;camera[12]=test.cameraX??0;cameraInverse[12]=-c*camera[12];cameraInverse[14]=-s*camera[12];return {transform: {matrix: camera}, views: [{projectionMatrix: P, transform: {matrix: camera, inverse: {matrix: cameraInverse}}}]}; }
    getHitTestResults() {
      if (!test.spatial) return [];
      test.hitReady = true;
      const placement = new Float32Array(I); placement[14] = test.placementZ ?? -1;
      return [{getPose: () => ({transform: {matrix: placement}})}];
    }
    getDepthInformation() {
      if (!test.active) throw new DOMException('Inactive synthetic frame', 'InvalidStateError');
      test.reads++;
      if (test.maxDepthReads && test.reads > test.maxDepthReads) return null;
      if (test.scenario === 'missing') return null;
      if (test.scenario === 'error') throw new DOMException('Synthetic read failure', 'InvalidStateError');
      return {
        width: test.highResolution ? 160 : 8, height: test.highResolution ? 90 : 8, rawValueToMeters: .001, normDepthBufferFromNormView: {matrix: I},
        get data() {
          if (!test.active) throw new DOMException('Inactive synthetic depth buffer', 'InvalidStateError');
          const depth=test.depthMeters??2;
          if(depth!==previousDepth){new Uint16Array(data).fill(Math.round(depth*1000));new Uint16Array(detailedData).fill(Math.round(depth*1000));previousDepth=depth;}
          return test.highResolution ? detailedData : data;
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
        requestReferenceSpace: async type => {
          const ref = new EventTarget(); if (type === 'local') test.resetReference = () => ref.dispatchEvent(new Event('reset'));
          return ref;
        },
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
      test.place = () => handlers.select?.();
      return session;
    },
  }});
})();
