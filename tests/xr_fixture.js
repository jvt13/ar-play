// Browser-only TEST FIXTURE. No physical XR/depth measurements. Never shipped in the site.
(() => {
  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const test = window.__xrTest = {scenario: 'granted', reads: 0, requests: [], active: false};
  test.step=(count=1,dt=16)=>{for(let i=0;i<count;i++){const callback=test.pending;test.pending=null;if(!callback)throw Error('No pending manual XR frame');test.clock=(test.clock??1000)+dt;test.active=true;try{callback(test.clock,new FakeFrame(test.session));}finally{test.active=false;}}};
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
    getViewerPose() { if(test.poseMissing)return null;const angle=test.cameraYaw??0,c=Math.cos(angle),s=Math.sin(angle),pitch=test.cameraPitch??0,cp=Math.cos(pitch),sp=Math.sin(pitch);camera[0]=c;camera[1]=0;camera[2]=-s;camera[4]=s*sp;camera[5]=cp;camera[6]=c*sp;camera[8]=s*cp;camera[9]=-sp;camera[10]=c*cp;camera[12]=test.cameraX??0;camera[13]=test.cameraY??.35;for(let col=0;col<3;col++)for(let row=0;row<3;row++)cameraInverse[col*4+row]=camera[row*4+col];for(let row=0;row<3;row++)cameraInverse[12+row]=-(camera[row*4]*camera[12]+camera[row*4+1]*camera[13]);return {transform: {matrix: camera}, views: [{projectionMatrix: P, transform: {matrix: camera, inverse: {matrix: cameraInverse}}}]}; }
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
          if(test.supportScene){
            const values=new Uint16Array(detailedData),box=[.55,.02,-1.8,1.2,.6,-.5];
            for(let y=0;y<90;y++)for(let x=0;x<160;x++){
              const vx=(2*(x+.5)/160-1)/P[0],vy=(1-2*(y+.5)/90)/P[5],d=[camera[0]*vx+camera[4]*vy-camera[8],camera[1]*vx+camera[5]*vy-camera[9],camera[2]*vx+camera[6]*vy-camera[10]];
              let t=d[1]<0?-camera[13]/d[1]:Infinity;
              if(test.supportScene==='box'){let lo=0,hi=Infinity;for(let a=0;a<3;a++){const p=(box[a]-camera[12+a])/d[a],q=(box[a+3]-camera[12+a])/d[a];lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));}if(lo<=hi&&hi>0)t=Math.min(t,lo);}
              values[y*160+x]=t>=.15&&t<=6?Math.round(t*1000):0;
            }
          }
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
        visibilityState:'visible',
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
          if(test.manualFrames){test.pending=callback;return;}
          requestAnimationFrame(time => {
            if (this.ended) return;
            test.active = true;
            test.clock=time;
            try { callback(time, new FakeFrame(this)); } finally { test.active = false; }
          });
        },
        async end() { this.ended = true; handlers.end?.(); },
      };
      test.session=session;
      test.visibility=state=>{session.visibilityState=state;handlers.visibilitychange?.({session});};
      test.place = () => handlers.select?.();
      return session;
    },
  }});
})();
