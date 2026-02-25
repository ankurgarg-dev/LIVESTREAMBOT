export type LiquidOrbState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'interrupted'
  | 'paused'
  | 'reconnecting'
  | 'error'
  | 'completed'
  | 'muted_or_no_mic';

type OrbParams = {
  baseSpeed: number;
  baseAmplitude: number;
  internalGradientDrift: number;
  shimmerStrength: number;
  accentWeight: number;
  saturation: number;
  diffusion: number;
  compactness: number;
  halo: number;
  inwardBias: number;
};

const STANDARD = {
  c1: '#21A6BD',
  c2: '#45AFC2',
  c3: '#44AAC0',
  c4: '#4BC984',
  c5: '#67C381',
};

const EXTENDED = {
  orange: '#E05E00',
  purple: '#68125E',
  yellow: '#FCDE0F',
  red: '#BF0D3F',
};

const PRESETS: Record<LiquidOrbState, OrbParams> = {
  idle: { baseSpeed: 0.14, baseAmplitude: 0.22, internalGradientDrift: 0.14, shimmerStrength: 0.1, accentWeight: 0.34, saturation: 1, diffusion: 0.94, compactness: 1, halo: 0.22, inwardBias: 0 },
  listening: { baseSpeed: 0.2, baseAmplitude: 0.28, internalGradientDrift: 0.2, shimmerStrength: 0.12, accentWeight: 0.42, saturation: 1.04, diffusion: 0.98, compactness: 0.97, halo: 0.24, inwardBias: 0.12 },
  processing: { baseSpeed: 0.16, baseAmplitude: 0.23, internalGradientDrift: 0.3, shimmerStrength: 0.18, accentWeight: 0.42, saturation: 1, diffusion: 0.96, compactness: 0.99, halo: 0.2, inwardBias: 0.05 },
  speaking: { baseSpeed: 0.22, baseAmplitude: 0.3, internalGradientDrift: 0.24, shimmerStrength: 0.15, accentWeight: 0.45, saturation: 1.1, diffusion: 1.08, compactness: 1.05, halo: 0.36, inwardBias: -0.06 },
  interrupted: { baseSpeed: 0.24, baseAmplitude: 0.34, internalGradientDrift: 0.24, shimmerStrength: 0.12, accentWeight: 0.45, saturation: 1.03, diffusion: 1, compactness: 0.94, halo: 0.26, inwardBias: 0.14 },
  paused: { baseSpeed: 0.035, baseAmplitude: 0.07, internalGradientDrift: 0.06, shimmerStrength: 0.05, accentWeight: 0.24, saturation: 0.78, diffusion: 0.74, compactness: 0.985, halo: 0.1, inwardBias: 0.02 },
  reconnecting: { baseSpeed: 0.14, baseAmplitude: 0.23, internalGradientDrift: 0.2, shimmerStrength: 0.2, accentWeight: 0.42, saturation: 0.96, diffusion: 0.9, compactness: 0.995, halo: 0.22, inwardBias: 0 },
  error: { baseSpeed: 0.09, baseAmplitude: 0.15, internalGradientDrift: 0.11, shimmerStrength: 0.06, accentWeight: 0.32, saturation: 0.62, diffusion: 0.84, compactness: 0.96, halo: 0.17, inwardBias: 0.08 },
  completed: { baseSpeed: 0.11, baseAmplitude: 0.18, internalGradientDrift: 0.12, shimmerStrength: 0.09, accentWeight: 0.32, saturation: 1, diffusion: 0.9, compactness: 1.01, halo: 0.22, inwardBias: -0.02 },
  muted_or_no_mic: { baseSpeed: 0.12, baseAmplitude: 0.2, internalGradientDrift: 0.11, shimmerStrength: 0.1, accentWeight: 0.34, saturation: 0.95, diffusion: 0.88, compactness: 0.98, halo: 0.16, inwardBias: 0.08 },
};

type ParamKey = keyof OrbParams;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function smoothDamp(current: number, target: number, dt: number, tauMs: number): number {
  const tau = Math.max(0.001, tauMs / 1000);
  const alpha = 1 - Math.exp(-dt / tau);
  return current + (target - current) * alpha;
}

function smoothAudio(current: number, target: number, dt: number, attackMs: number, releaseMs: number): number {
  const tau = target > current ? attackMs : releaseMs;
  return smoothDamp(current, target, dt, tau);
}

function hashNoise(x: number): number {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise1D(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hashNoise(i);
  const b = hashNoise(i + 1);
  return a * (1 - u) + b * u;
}

function fbm1D(x: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise1D(x * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

function withAlpha(hex: string, alpha: number): string {
  const a = clamp(alpha, 0, 1);
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export class LiquidGlassOrb {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly offA: HTMLCanvasElement;
  private readonly offB: HTMLCanvasElement;
  private readonly ctxA: CanvasRenderingContext2D;
  private readonly ctxB: CanvasRenderingContext2D;

  private state: LiquidOrbState = 'idle';
  private rafId: number | null = null;
  private lastAt = performance.now();
  private phase = 0;
  private phase2 = 0;
  private phase3 = 0;
  private transitionTauMs = 420;

  private audioIn = 0;
  private ttsIn = 0;
  private audioSmooth = 0;
  private ttsSmooth = 0;

  private current: OrbParams = { ...PRESETS.idle };
  private target: OrbParams = { ...PRESETS.idle };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for LiquidGlassOrb');
    this.ctx = ctx;
    this.offA = document.createElement('canvas');
    this.offB = document.createElement('canvas');
    const a = this.offA.getContext('2d');
    const b = this.offB.getContext('2d');
    if (!a || !b) throw new Error('Offscreen 2D context unavailable for LiquidGlassOrb');
    this.ctxA = a;
    this.ctxB = b;
    this.resize();
  }

  resize(): void {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const bounds = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(bounds.width * ratio));
    const h = Math.max(1, Math.floor(bounds.height * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.offA.width = w;
      this.offA.height = h;
      this.offB.width = w;
      this.offB.height = h;
    }
  }

  setState(state: LiquidOrbState, transitionMs = 420): void {
    this.state = state;
    this.target = { ...(PRESETS[state] || PRESETS.idle) };
    this.transitionTauMs = clamp(transitionMs, 250, 600);
  }

  setAudioLevel(level0to1: number): void {
    this.audioIn = clamp01(level0to1);
  }

  setTtsLevel(level0to1: number): void {
    this.ttsIn = clamp01(level0to1);
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastAt = performance.now();
    const tick = (at: number) => {
      this.render(at);
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private updateDynamics(dt: number): void {
    this.audioSmooth = smoothAudio(this.audioSmooth, this.audioIn, dt, 30, 200);
    this.ttsSmooth = smoothAudio(this.ttsSmooth, this.ttsIn, dt, 30, 200);
    for (const key of Object.keys(this.current) as ParamKey[]) {
      this.current[key] = smoothDamp(this.current[key], this.target[key], dt, this.transitionTauMs);
    }
  }

  private buildBlobPath(
    cx: number,
    cy: number,
    rBase: number,
    amp: number,
    compactness: number,
    inwardBias: number,
  ): Path2D {
    const path = new Path2D();
    const steps = 128;
    for (let i = 0; i <= steps; i += 1) {
      const a = (Math.PI * 2 * i) / steps;
      const q = a / (Math.PI * 2);
      const n1 = fbm1D(this.phase + q * 2.2, 5) * 2 - 1;
      const n2 = fbm1D(this.phase2 + q * 3.4, 5) * 2 - 1;
      const n3 = fbm1D(this.phase3 + q * 4.4, 4) * 2 - 1;
      const lobeA = Math.max(0, Math.sin(a * 2 + this.phase * 2.0)) * 0.16;
      const lobeB = Math.max(0, Math.sin(a * 3 - this.phase2 * 1.8)) * 0.13;
      const lobeC = Math.max(0, Math.sin(a * 4 + this.phase3 * 1.4)) * 0.11;
      const distortion = (n1 * 0.7 + n2 * 0.5 + n3 * 0.3 + lobeA + lobeB + lobeC) * 1.35;
      const inward = inwardBias * Math.cos(a);
      const r = rBase * compactness * (1 + amp * distortion - inward * 0.06);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  private accentColorsByState(state: LiquidOrbState): [string, string, string] {
    if (state === 'listening') return [EXTENDED.purple, EXTENDED.yellow, EXTENDED.purple];
    if (state === 'processing') return [EXTENDED.yellow, EXTENDED.purple, EXTENDED.yellow];
    if (state === 'speaking') return [EXTENDED.orange, EXTENDED.purple, EXTENDED.yellow];
    if (state === 'interrupted') return [EXTENDED.orange, EXTENDED.yellow, EXTENDED.orange];
    if (state === 'reconnecting') return [EXTENDED.yellow, EXTENDED.purple, EXTENDED.yellow];
    if (state === 'error') return [EXTENDED.red, EXTENDED.orange, EXTENDED.red];
    if (state === 'muted_or_no_mic') return [EXTENDED.yellow, EXTENDED.orange, EXTENDED.yellow];
    return [EXTENDED.purple, EXTENDED.yellow, EXTENDED.purple];
  }

  private drawInterior(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    drift: number,
    accentWeight: number,
    state: LiquidOrbState,
    energy: number,
  ): void {
    const main = ctx.createRadialGradient(w * 0.42, h * 0.4, w * 0.06, w * 0.52, h * 0.52, w * 0.46);
    main.addColorStop(0, withAlpha(STANDARD.c2, 0.84));
    main.addColorStop(0.4, withAlpha(STANDARD.c1, 0.74));
    main.addColorStop(0.7, withAlpha(STANDARD.c3, 0.62));
    main.addColorStop(1, withAlpha(STANDARD.c5, 0.52));
    ctx.fillStyle = main;
    ctx.fillRect(0, 0, w, h);

    const ix = w * (0.34 + Math.sin(this.phase2 * 0.8) * 0.11 * drift);
    const iy = h * (0.35 + Math.cos(this.phase * 0.9) * 0.1 * drift);
    const jx = w * (0.62 + Math.cos(this.phase3 * 0.75) * 0.12 * drift);
    const jy = h * (0.62 + Math.sin(this.phase2 * 0.85) * 0.11 * drift);
    const g1 = ctx.createRadialGradient(ix, iy, w * 0.04, ix, iy, w * 0.34);
    g1.addColorStop(0, withAlpha(STANDARD.c4, 0.56));
    g1.addColorStop(1, withAlpha(STANDARD.c4, 0));
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);
    const g2 = ctx.createRadialGradient(jx, jy, w * 0.04, jx, jy, w * 0.36);
    g2.addColorStop(0, withAlpha(STANDARD.c2, 0.48));
    g2.addColorStop(1, withAlpha(STANDARD.c2, 0));
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    const [rA, rB, rC] = this.accentColorsByState(state);
    const aw = clamp(accentWeight, 0.24, 0.45);
    const op = 0.09 + aw * 0.28;
    const travel = this.phase * (0.22 + energy * 1.2);
    const yA = h * (0.34 + Math.sin(travel) * 0.12);
    const yB = h * (0.6 + Math.cos(travel * 0.85 + 1.2) * 0.12);
    const yC = h * (0.48 + Math.sin(travel * 1.2 + 2.2) * 0.14);

    const drawCurvedRibbon = (
      color: string,
      y: number,
      bend: number,
      widthFactor: number,
      opacityFactor: number,
      driftPhase: number,
    ) => {
      const startX = w * 0.12;
      const endX = w * 0.88;
      const cp1x = w * 0.34 + Math.sin(driftPhase) * w * 0.08;
      const cp2x = w * 0.66 + Math.cos(driftPhase * 0.9) * w * 0.08;
      const cp1y = y - bend * h * 0.22;
      const cp2y = y + bend * h * 0.2;
      const ribbon = new Path2D();
      ribbon.moveTo(startX, y);
      ribbon.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, y + bend * h * 0.04);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.filter = 'blur(6px)';
      const g = ctx.createLinearGradient(startX, y, endX, y + bend * h * 0.06);
      g.addColorStop(0, withAlpha(color, 0));
      g.addColorStop(0.32, withAlpha(color, op * 0.72 * opacityFactor));
      g.addColorStop(0.5, withAlpha(color, op * 1.18 * opacityFactor));
      g.addColorStop(0.76, withAlpha(color, op * 0.68 * opacityFactor));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = h * widthFactor;
      ctx.stroke(ribbon);
      ctx.restore();
    };

    drawCurvedRibbon(rA, yA, Math.sin(travel * 0.8), 0.09, 1.0, travel);
    drawCurvedRibbon(rB, yB, -Math.cos(travel * 0.75), 0.075, 0.9, travel + 1.2);
    drawCurvedRibbon(rC, yC, Math.sin(travel * 1.05 + 0.8), 0.06, 0.82, travel + 2.1);
  }

  private drawGlassEdge(
    ctx: CanvasRenderingContext2D,
    path: Path2D,
    w: number,
    h: number,
    halo: number,
    state: LiquidOrbState,
    shimmer: number,
    energy: number,
  ): void {
    ctx.save();
    ctx.filter = 'blur(12px)';
    ctx.strokeStyle = withAlpha(STANDARD.c2, 0.25 + halo * 0.32);
    ctx.lineWidth = Math.max(2.5, w * 0.016);
    ctx.stroke(path);
    ctx.restore();

    ctx.save();
    ctx.filter = 'blur(28px)';
    ctx.strokeStyle = withAlpha(STANDARD.c4, 0.12 + halo * 0.24);
    ctx.lineWidth = Math.max(4, w * 0.024);
    ctx.stroke(path);
    ctx.restore();

    ctx.save();
    ctx.clip(path);
    const hi = ctx.createLinearGradient(w * 0.24, h * 0.2, w * 0.76, h * 0.74);
    hi.addColorStop(0, withAlpha('#8DD5DF', 0.16));
    hi.addColorStop(0.5, withAlpha('#8DD5DF', 0.05));
    hi.addColorStop(1, withAlpha('#8DD5DF', 0));
    ctx.fillStyle = hi;
    ctx.fillRect(w * 0.15, h * 0.12, w * 0.72, h * 0.76);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineWidth = Math.max(1, w * 0.0045);
    ctx.translate(0.8, 0);
    ctx.strokeStyle = withAlpha('#4BC984', 0.07);
    ctx.stroke(path);
    ctx.translate(-1.6, 0);
    ctx.strokeStyle = withAlpha('#45AFC2', 0.065);
    ctx.stroke(path);
    ctx.restore();

    if (state === 'reconnecting') {
      const cyc = (this.phase % 2) / 2;
      ctx.save();
      ctx.strokeStyle = withAlpha(EXTENDED.yellow, 0.08 * (1 - cyc) + shimmer * 0.05);
      ctx.lineWidth = Math.max(1, w * 0.006);
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.5, w * (0.36 + 0.09 * cyc), h * (0.33 + 0.08 * cyc), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (state === 'error') {
      const pulse = (Math.sin(this.phase2 * 1.7) + 1) * 0.5;
      ctx.save();
      ctx.filter = 'blur(8px)';
      ctx.strokeStyle = withAlpha(EXTENDED.red, 0.12 + pulse * 0.14);
      ctx.lineWidth = Math.max(3, w * 0.018);
      ctx.stroke(path);
      ctx.restore();
    }

    // Energy emission aura outside blob.
    const aura = 0.09 + halo * 0.18 + energy * 0.24;
    ctx.save();
    ctx.filter = 'blur(24px)';
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = withAlpha(STANDARD.c2, aura);
    ctx.lineWidth = Math.max(6, w * 0.032);
    ctx.stroke(path);
    ctx.restore();
  }

  render(at: number): void {
    this.resize();
    const dt = clamp((at - this.lastAt) / 1000, 0.001, 0.05);
    this.lastAt = at;
    this.updateDynamics(dt);

    const stateSlowdown = this.state === 'paused' ? 0.25 : 1;
    const speakingEnergy = Math.pow(this.ttsSmooth, 0.7);
    const listeningEnergy = Math.pow(this.audioSmooth, 0.7);
    const energy = clamp01(Math.max(speakingEnergy, listeningEnergy));
    const speed = this.current.baseSpeed * stateSlowdown + energy * (this.state === 'listening' ? 0.4 : 0.32);
    this.phase += dt * speed * 1.3;
    this.phase2 += dt * speed * 1.0;
    this.phase3 += dt * speed * 1.55;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const ampGain = this.state === 'listening' ? 0.38 : this.state === 'speaking' ? 0.46 : 0.28;
    const speedGain = this.state === 'listening' ? 0.4 : this.state === 'speaking' ? 0.32 : 0.24;
    const amp = this.current.baseAmplitude * stateSlowdown + energy * ampGain;
    const pulseScale = 1 + Math.sin(this.phase * 0.55) * 0.026 + energy * 0.05;
    const rBase = Math.min(w, h) * 0.308 * pulseScale;

    let compactness = this.current.compactness;
    if (this.state === 'listening') compactness -= energy * 0.02;
    if (this.state === 'speaking') compactness += energy * 0.03;

    const cx = w * 0.5 + Math.sin(this.phase * 0.33) * w * 0.012;
    const cy = h * 0.5 + Math.cos(this.phase2 * 0.3) * h * 0.012;
    const path = this.buildBlobPath(cx, cy, rBase, amp, compactness, this.current.inwardBias);

    this.ctxA.clearRect(0, 0, w, h);
    this.ctxB.clearRect(0, 0, w, h);
    this.ctxA.save();
    this.ctxA.clip(path);
    this.drawInterior(
      this.ctxA,
      w,
      h,
      this.current.internalGradientDrift + energy * speedGain,
      this.current.accentWeight,
      this.state,
      energy,
    );
    this.ctxA.restore();

    const warpX = Math.sin(this.phase * 1.7) * (w * 0.012) + fbm1D(this.phase * 0.7) * (w * 0.008);
    const warpY = Math.cos(this.phase2 * 1.4) * (h * 0.012) + fbm1D(this.phase2 * 0.65 + 2) * (h * 0.008);
    this.ctxB.globalAlpha = 0.86;
    this.ctxB.drawImage(this.offA, 0, 0);
    this.ctxB.globalAlpha = 0.1;
    this.ctxB.drawImage(this.offA, warpX, warpY);
    this.ctxB.globalAlpha = 0.08;
    this.ctxB.drawImage(this.offA, -warpX * 0.7, -warpY * 0.7);
    this.ctxB.globalAlpha = 1;

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.save();
    this.ctx.filter = `saturate(${(this.current.saturation * 130).toFixed(0)}%) contrast(112%)`;
    this.ctx.drawImage(this.offB, 0, 0);
    this.ctx.restore();

    // Translucent bloom pass for glass vibrance.
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'screen';
    this.ctx.globalAlpha = 0.24 + energy * 0.16;
    this.ctx.filter = 'blur(18px)';
    this.ctx.drawImage(this.offB, 0, 0);
    this.ctx.restore();

    this.drawGlassEdge(
      this.ctx,
      path,
      w,
      h,
      this.current.halo + energy * 0.14,
      this.state,
      this.current.shimmerStrength,
      energy,
    );
  }
}
