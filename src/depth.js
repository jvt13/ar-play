// Experimental CPU diagnostics. Depth objects/buffers are consumed only inside XRFrame.
// https://www.w3.org/TR/webxr-depth-sensing-1/
const FORMATS = new Set(['luminance-alpha', 'float32', 'unsigned-short']);
const MAP_WIDTH = 32, MAP_HEIGHT = 24;

export async function requestDepthSession(xr, options) {
  const requested = {
    ...options,
    optionalFeatures: [...(options.optionalFeatures || []), 'depth-sensing'],
    depthSensing: {
      usagePreference: ['cpu-optimized'],
      matchDepthView: true,
      // These two enum values are also understood by earlier Chrome implementations.
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
  };
  try {
    return {session: await xr.requestSession('immersive-ar', requested), fallback: false};
  } catch (error) {
    // A conforming UA ignores unsupported optional depth. Older implementations may reject it.
    // Never retry user permission/security failures, and preserve the original required features.
    if (error.name !== 'NotSupportedError' && error.name !== 'TypeError') throw error;
    return {session: await xr.requestSession('immersive-ar', options), fallback: true};
  }
}

export function createDepthReader(info, format) {
  const {width, height, rawValueToMeters: scale} = info;
  const matrix = info.normDepthBufferFromNormView?.matrix;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      !Number.isSafeInteger(width * height) || !Number.isFinite(scale) || scale <= 0 ||
      !matrix || matrix.length !== 16 || !matrix.every(Number.isFinite) || !FORMATS.has(format)) {
    throw new Error('Metadados de profundidade inválidos');
  }
  const Type = format === 'float32' ? Float32Array : Uint16Array;
  const buffer = info.data;
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Buffer de profundidade inválido');
  const data = new Type(buffer, 0, width * height);
  // One typed view per sampled frame; no copies, per-pixel objects or retained XR resources.
  return {
    width, height, lastIndex: -1,
    at(x, y, strict = false) {
      this.lastIndex = -1;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
      // Column-major normDepthBufferFromNormView, top-left normalized view coordinates.
      const w = matrix[3] * x + matrix[7] * y + matrix[15];
      if (!Number.isFinite(w) || Math.abs(w) < 1e-8) return null;
      const u = (matrix[0] * x + matrix[4] * y + matrix[12]) / w;
      const v = (matrix[1] * x + matrix[5] * y + matrix[13]) / w;
      if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
      if (strict && (u < 0 || u > 1 || v < 0 || v > 1)) return null;
      const col = Math.max(0, Math.min(width - 1, Math.trunc(u * width)));
      const row = Math.max(0, Math.min(height - 1, Math.trunc(v * height)));
      this.lastIndex = row * width + col;
      const meters = data[this.lastIndex] * scale;
      return Number.isFinite(meters) && meters > 0 ? meters : null;
    },
  };
}

const LABELS = {
  off: 'Desativado', unsupported: 'Não suportado: API CPU ausente',
  'not-granted': 'Não concedido', waiting: 'Aguardando dados',
  available: 'Dados disponíveis', error: 'Falha de leitura',
};

export class DepthDiagnostics {
  constructor(elements = {}, now = () => performance.now()) {
    this.elements = elements;
    this.now = now;
    this.state = {};
    this.stop();
    if (elements.button) elements.button.onclick = () => this.setEnabled(!this.enabled);
    if (elements.mapToggle) elements.mapToggle.onchange = () => this.setMapEnabled(!!elements.mapToggle.checked);
  }

  start(session, {apiAvailable = typeof globalThis.XRFrame?.prototype?.getDepthInformation === 'function', fallback = false} = {}) {
    this.stop();
    this.session = session;
    this.state.xr = 'Disponível';
    this.state.session = 'Ativa';
    this.capability = apiAvailable ? 'not-granted' : 'unsupported';
    this.reason = fallback ? 'Sessão iniciada sem a extensão opcional.' : 'Suporte do aparelho não confirmado.';
    try {
      // These getters may throw InvalidStateError when the optional feature was not granted.
      const features = session.enabledFeatures;
      if (!features || features.includes('depth-sensing')) {
        this.state.usage = session.depthUsage || null;
        this.state.format = session.depthDataFormat || null;
        if (apiAvailable && this.state.usage === 'cpu-optimized' && FORMATS.has(this.state.format)) {
          this.capability = 'waiting';
          this.reason = '';
        } else if (apiAvailable && this.state.usage) {
          this.capability = 'error';
          this.reason = 'Modo ou formato concedido sem leitor CPU compatível.';
        }
      }
    } catch {
      // Lack of depth never affects hit-test, rendering or the lifetime of the AR session.
    }
    this.render();
  }

  clearMeasurements() {
    Object.assign(this.state, {width: null, height: null, center: null, valid: null, total: null, costMs: null});
    if (this.elements.mapCanvas) this.elements.mapCanvas.hidden = true;
    this.context?.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }

  setEnabled(enabled) {
    this.enabled = !!enabled && !!this.session;
    this.lastRead = -Infinity;
    this.lastFrame = null;
    this.interval = 250;
    this.state.fps = null;
    this.clearMeasurements();
    this.state.status = this.enabled ? this.capability : 'off';
    this.state.detail = this.enabled ? this.reason : '';
    if (!this.enabled) this.setMapEnabled(false);
    this.render();
  }

  setMapEnabled(enabled) {
    this.mapEnabled = !!enabled && this.enabled && this.capability === 'waiting';
    if (this.elements.mapToggle) this.elements.mapToggle.checked = this.mapEnabled;
    if (this.mapEnabled && this.elements.mapCanvas && !this.context) {
      this.context = this.elements.mapCanvas.getContext('2d');
      this.image = this.context?.createImageData(MAP_WIDTH, MAP_HEIGHT) || null;
    }
    if (!this.mapEnabled) {
      if (this.elements.mapCanvas) this.elements.mapCanvas.hidden = true;
      this.image?.data.fill(0);
      this.context?.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    }
    this.lastRead = -Infinity;
  }

  update(time, frame, view, consumer = null) {
    if (frame.session !== this.session) return;
    if (this.enabled) {
      if (this.lastFrame !== null && time > this.lastFrame) {
        const fps = 1000 / (time - this.lastFrame);
        this.state.fps = this.state.fps === null ? fps : this.state.fps * .9 + fps * .1;
      }
      this.lastFrame = time;
    }
    const diagnosticDue = this.enabled && time - this.lastRead >= this.interval;
    const spatialDue = !!consumer?.wantsDepth(time);
    if (!diagnosticDue && !spatialDue) return;
    if (diagnosticDue) {
      this.lastRead = time; this.clearMeasurements();
      this.state.status = this.capability; this.state.detail = this.reason;
    }
    const started = this.now();
    if(spatialDue)consumer.acquisitionMs=consumer.nativeReadMs=consumer.readerMs=null;
    let attempted = false;
    try {
      if (this.capability === 'waiting' && view) {
        attempted = true;
        if (typeof frame.getDepthInformation !== 'function') throw new Error('CPU reader absent');
        const nativeStarted=this.now();const info = frame.getDepthInformation(view);
        if(consumer)consumer.nativeReadMs=Math.max(0,this.now()-nativeStarted);
        if (info) {
          // Exactly one native acquisition and one typed reader for both consumers.
          const readerStarted=this.now();const reader = createDepthReader(info, this.state.format);
          if(consumer)consumer.readerMs=Math.max(0,this.now()-readerStarted);
          const acquisitionMs = Math.max(0, this.now() - started);
          if(consumer)consumer.acquisitionMs=acquisitionMs;
          if (spatialDue) {
            try { consumer.accept(time, reader, info, view); }
            catch { consumer.missing(time, 'error'); }
          }
          if (diagnosticDue) {
            const diagnosticStart = this.now();
            this.state.width = reader.width; this.state.height = reader.height;
            this.state.center = reader.at(.5, .5);
            const columns = this.mapEnabled ? MAP_WIDTH : 8, rows = this.mapEnabled ? MAP_HEIGHT : 8;
            let valid = 0;
            for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
              const meters = reader.at((x + .5) / columns, (y + .5) / rows);
              if (meters !== null) valid++;
              if (this.mapEnabled && this.image) {
                const i = (y * columns + x) * 4;
                const light = meters === null ? 0 : Math.round(32 + 223 * (1 - Math.min(meters, 5) / 5));
                this.image.data[i] = this.image.data[i + 1] = this.image.data[i + 2] = light;
                this.image.data[i + 3] = 255;
              }
            }
            this.state.valid = valid; this.state.total = columns * rows;
            const available = valid > 0 || this.state.center !== null;
            this.state.status = available ? 'available' : 'waiting';
            this.state.detail = available ? '' : 'Sem amostras válidas na grade';
            if (this.mapEnabled && this.image) { this.context.putImageData(this.image, 0, 0); this.elements.mapCanvas.hidden = false; }
            this.state.costMs = acquisitionMs + Math.max(0, this.now() - diagnosticStart);
          }
        } else if (spatialDue) consumer.missing(time, 'waiting');
      } else if (spatialDue) consumer.missing(time, this.capability === 'waiting' ? 'tracking' : 'unavailable');
    } catch (error) {
      if (diagnosticDue) { this.clearMeasurements(); this.state.status = 'error'; this.state.detail = error.name || 'Error'; }
      if (spatialDue) consumer.missing(time, 'error');
    }
    if (diagnosticDue) {
      if (attempted && this.state.costMs === null) this.state.costMs = Math.max(0, this.now() - started);
      if (this.state.costMs > 8) this.interval = 1000;
      this.render();
    }
  }

  snapshot() {
    return {...this.state, enabled: this.enabled, mapEnabled: this.mapEnabled, interval: this.interval};
  }

  render() {
    const {button, panel, readout} = this.elements;
    if (button) {
      button.setAttribute('aria-expanded', String(!!this.enabled));
      button.setAttribute('aria-pressed', String(!!this.enabled));
    }
    if (panel) panel.hidden = !this.enabled;
    if (this.elements.mapToggle) this.elements.mapToggle.disabled = this.capability !== 'waiting';
    if (!readout || !this.enabled) return;
    const s = this.state;
    readout.textContent = `WebXR: ${s.xr}\nSessão AR: ${s.session}\nProfundidade: ${LABELS[s.status]}${s.detail ? '\n' + s.detail : ''}\nAcesso: ${s.usage || '—'}\nFormato: ${s.format || '—'}\nResolução: ${s.width ? s.width + ' × ' + s.height : '—'}\nCentro (plano da câmera): ${s.center === null ? '—' : s.center.toFixed(2) + ' m'}\nAmostras da vista: ${s.total ? s.valid + '/' + s.total + ' (' + Math.round(100 * s.valid / s.total) + '%)' : '—'}\nFPS XR estimado: ${s.fps === null ? '—' : s.fps.toFixed(0)}\nLeitura: ${s.costMs === null ? '—' : s.costMs.toFixed(1) + ' ms'}${this.interval === 1000 ? ' (reduzida: 1 Hz)' : ''}`;
  }

  stop() {
    this.enabled = false;
    this.mapEnabled = false;
    this.session = null;
    this.capability = 'not-granted';
    this.reason = '';
    this.lastRead = -Infinity;
    this.lastFrame = null;
    this.interval = 250;
    this.clearMeasurements();
    this.context = null;
    this.image = null;
    Object.assign(this.state, {xr: globalThis.navigator?.xr ? 'Disponível' : 'Não suportado', session: 'Encerrada', usage: null, format: null, fps: null, status: 'off', detail: ''});
    if (this.elements.mapToggle) this.elements.mapToggle.checked = false;
    if (this.elements.readout) this.elements.readout.textContent = '';
    this.render();
  }
}
