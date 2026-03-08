import * as THREE from 'three';
import type { VisualizerState, VoiceVisualizer } from './VoiceVisualizer';

const BRAND_COLORS = {
  primary: '#21A6BD',
  secondary: '#4BC984',
  accent: '#45AFC2',
  charcoal: '#333536',
  neutral: '#7F7F7F',
  dark: '#192123',
  accentPurple: '#68125E',
  accentOrange: '#E05E00',
} as const;

function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export class ParticleHaloVisualizer implements VoiceVisualizer {
  private container?: HTMLElement;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private points?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private core?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private ambientLight?: THREE.AmbientLight;
  private pointLight?: THREE.PointLight;
  private resizeObserver?: ResizeObserver;
  private rafId = 0;
  private startTime = 0;

  private state: VisualizerState = 'idle';
  private previousState: VisualizerState = 'idle';
  private stateTransitionStart = 0;
  private stateTransitionDuration = 0.55;
  private cueEndAt = 0;
  private smoothedAmplitude = 0;
  private fastAmplitude = 0;
  private particleEnergy = 0;
  private visibleParticleCount = 1200;
  private coreScale = 1;
  private coreGlow = 0.45;

  private analyser?: AnalyserNode;
  private silentGain?: GainNode;
  private timeDomainData?: Uint8Array<ArrayBuffer>;
  private audioConnected = false;

  private positions?: Float32Array;
  private baseRadius?: Float32Array;
  private baseTheta?: Float32Array;
  private basePhi?: Float32Array;
  private speed?: Float32Array;
  private color?: Float32Array;
  private readonly tintColor = new THREE.Color(BRAND_COLORS.primary);
  private readonly tintTarget = new THREE.Color(BRAND_COLORS.primary);
  private readonly accentColor = new THREE.Color(BRAND_COLORS.accent);

  init(container: HTMLElement): void {
    this.container = container;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 4.8);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(BRAND_COLORS.dark, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.62);
    const point = new THREE.PointLight(0x6fd4df, 1.1, 18);
    point.position.set(2.2, 1.6, 2.8);
    scene.add(ambient, point);
    this.ambientLight = ambient;
    this.pointLight = point;

    this.buildParticleCloud();
    this.buildCore();

    const observer = new ResizeObserver(() => this.onResize());
    observer.observe(container);
    this.resizeObserver = observer;
    this.onResize();

    this.startTime = performance.now() * 0.001;
    this.animate();
  }

  connectAudio(audioContext: AudioContext, sourceNode: AudioNode): void {
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // Ignore disconnection race.
      }
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {
        // Ignore disconnection race.
      }
      this.silentGain = undefined;
    }

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    this.timeDomainData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    this.analyser = analyser;

    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    this.silentGain = silentGain;

    if (!this.audioConnected) {
      sourceNode.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioContext.destination);
      this.audioConnected = true;
    }
  }

  setState(state: VisualizerState): void {
    if (state !== this.state) {
      this.previousState = this.state;
      this.state = state;
      const now = performance.now() * 0.001;
      this.stateTransitionStart = now;
      this.stateTransitionDuration = state === 'speaking' ? 0.32 : 0.55;
      this.cueEndAt = now + (state === 'speaking' ? 0.42 : 0.36);
    }
    this.state = state;
  }

  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;

    if (this.container && this.renderer?.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }

    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
    if (this.core) {
      this.core.geometry.dispose();
      this.core.material.dispose();
    }
    this.renderer?.dispose();

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // Ignore disconnection race.
      }
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {
        // Ignore disconnection race.
      }
    }

    this.container = undefined;
    this.scene = undefined;
    this.camera = undefined;
    this.renderer = undefined;
    this.points = undefined;
    this.core = undefined;
    this.ambientLight = undefined;
    this.pointLight = undefined;
    this.analyser = undefined;
    this.silentGain = undefined;
    this.timeDomainData = undefined;
    this.positions = undefined;
    this.baseRadius = undefined;
    this.baseTheta = undefined;
    this.basePhi = undefined;
    this.speed = undefined;
    this.color = undefined;
    this.audioConnected = false;
  }

  private buildParticleCloud(): void {
    if (!this.scene) return;

    const count = 1200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const radius = new Float32Array(count);
    const theta = new Float32Array(count);
    const phi = new Float32Array(count);
    const speed = new Float32Array(count);

    const cA = new THREE.Color(BRAND_COLORS.primary);
    const cB = new THREE.Color(BRAND_COLORS.secondary);
    const cC = new THREE.Color(BRAND_COLORS.accent);
    const cNeutral = new THREE.Color(BRAND_COLORS.neutral);
    const cPurple = new THREE.Color(BRAND_COLORS.accentPurple);
    const cOrange = new THREE.Color(BRAND_COLORS.accentOrange);
    const cCharcoal = new THREE.Color(BRAND_COLORS.charcoal);
    const temp = new THREE.Color();

    for (let i = 0; i < count; i += 1) {
      // Keep storm perimeter tighter than previous version (~10% smaller).
      const r = 0.58 + Math.random() * 0.86;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      const s = 0.25 + Math.random() * 1.2;

      radius[i] = r;
      theta[i] = t;
      phi[i] = p;
      speed[i] = s;

      const mix = Math.random();
      // Use mostly primary palette; keep expanded accents very limited.
      if (mix < 0.78) {
        temp.copy(cA).lerp(cB, mix * 0.62).lerp(cC, 0.18 + mix * 0.24);
      } else if (mix < 0.9) {
        temp.copy(cA).lerp(cNeutral, 0.28);
      } else if (mix < 0.96) {
        temp.copy(cC).lerp(cPurple, 0.2);
      } else {
        temp.copy(cB).lerp(cOrange, 0.14);
      }
      temp.lerp(cCharcoal, 0.06);
      colors[i * 3] = temp.r;
      colors[i * 3 + 1] = temp.g;
      colors[i * 3 + 2] = temp.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.032,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    this.points = points;
    this.positions = positions;
    this.baseRadius = radius;
    this.baseTheta = theta;
    this.basePhi = phi;
    this.speed = speed;
    this.color = colors;
  }

  private buildCore(): void {
    if (!this.scene) return;
    const geometry = new THREE.SphereGeometry(0.36, 44, 44);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(BRAND_COLORS.primary),
      emissive: new THREE.Color(BRAND_COLORS.accent),
      emissiveIntensity: this.coreGlow,
      roughness: 0.45,
      metalness: 0.22,
      transparent: true,
      opacity: 0.9,
    });
    const core = new THREE.Mesh(geometry, material);
    this.scene.add(core);
    this.core = core;
  }

  private onResize(): void {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    this.updateFrame(performance.now() * 0.001);
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private updateFrame(nowSeconds: number): void {
    if (!this.points || !this.core || !this.positions || !this.baseRadius || !this.baseTheta || !this.basePhi || !this.speed) {
      return;
    }

    const elapsed = nowSeconds - this.startTime;
    const raw = this.getAmplitude();
    // Attack/release envelope so visual follows voice rise/fall naturally.
    const fastLerp = raw > this.fastAmplitude ? 0.36 : 0.2;
    const slowLerp = raw > this.smoothedAmplitude ? 0.24 : 0.11;
    this.fastAmplitude = lerp(this.fastAmplitude, raw, fastLerp);
    this.smoothedAmplitude = lerp(this.smoothedAmplitude, this.fastAmplitude, slowLerp);

    const stateEnergy = (state: VisualizerState): number => {
      if (state === 'thinking') return 0.26 + Math.sin(elapsed * 1.35) * 0.03;
      if (state === 'speaking') return 0.28 + this.smoothedAmplitude * 1.35;
      return 0.13;
    };

    const targetEnergy = stateEnergy(this.state);
    const prevEnergy = stateEnergy(this.previousState);
    const transitionT = Math.min(
      1,
      Math.max(0, (nowSeconds - this.stateTransitionStart) / Math.max(0.001, this.stateTransitionDuration)),
    );
    const easedT = transitionT * transitionT * (3 - 2 * transitionT);
    const blendedEnergy = prevEnergy + (targetEnergy - prevEnergy) * easedT;

    let targetTint = this.tintTarget.set(BRAND_COLORS.primary);
    if (this.state === 'thinking') {
      targetTint = this.tintTarget.set(BRAND_COLORS.accent);
    } else if (this.state === 'speaking') {
      targetTint = this.tintTarget.set(BRAND_COLORS.secondary);
    }

    // State cue pulse on transitions: idle -> thinking -> speaking -> idle.
    const cueWindow = Math.max(0, this.cueEndAt - nowSeconds);
    const cueBoost = cueWindow > 0 ? Math.min(1, cueWindow / 0.42) * 0.05 : 0;
    this.particleEnergy = lerp(this.particleEnergy, blendedEnergy + cueBoost, 0.12);
    this.tintColor.lerp(targetTint, 0.08);

    const count = this.baseRadius.length;

    // Density tracks voice level in speaking state (more voice => more dots).
    const densityLevel =
      this.state === 'speaking'
        ? 0.55 + this.smoothedAmplitude * 0.45
        : this.state === 'thinking'
          ? 0.72
          : 0.6;
    const targetCount = Math.round(count * densityLevel);
    this.visibleParticleCount = Math.round(lerp(this.visibleParticleCount, targetCount, 0.14));
    this.points.geometry.setDrawRange(0, Math.max(180, Math.min(count, this.visibleParticleCount)));

    const pos = this.positions;

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      const drift = Math.sin(elapsed * (0.5 + this.speed[i]) + i * 0.023) * 0.058;
      const swirl = elapsed * (0.2 + this.speed[i] * (0.07 + this.particleEnergy * 0.19));
      const ampKick = this.smoothedAmplitude * (0.11 + this.speed[i] * 0.04);

      const radius = this.baseRadius[i] + drift + ampKick;
      const theta = this.baseTheta[i] + swirl;
      const phi = this.basePhi[i] + Math.sin(elapsed * 0.66 + i * 0.009) * 0.075;

      const sinPhi = Math.sin(phi);
      pos[idx] = radius * sinPhi * Math.cos(theta);
      pos[idx + 1] = radius * Math.cos(phi);
      pos[idx + 2] = radius * sinPhi * Math.sin(theta);
    }

    const geometry = this.points.geometry;
    const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
    positionAttr.needsUpdate = true;

    const pointsMaterial = this.points.material;
    pointsMaterial.size = 0.027 + this.particleEnergy * 0.012 + this.smoothedAmplitude * 0.003;
    pointsMaterial.opacity = 0.56 + this.particleEnergy * 0.3 + this.smoothedAmplitude * 0.08;
    pointsMaterial.color.copy(this.tintColor);

    const coreMaterial = this.core.material;
    const targetScale = 1 + this.particleEnergy * 0.18 + Math.sin(elapsed * 1.85) * 0.012;
    this.coreScale = lerp(this.coreScale, targetScale, 0.15);
    this.coreGlow = lerp(this.coreGlow, 0.34 + this.particleEnergy * 1.05, 0.14);
    this.core.scale.setScalar(this.coreScale);
    coreMaterial.emissiveIntensity = this.coreGlow;
    coreMaterial.emissive.copy(this.tintColor).lerp(this.accentColor, 0.28);
  }

  private getAmplitude(): number {
    if (!this.analyser || !this.timeDomainData) return 0;
    this.analyser.getByteTimeDomainData(this.timeDomainData);

    let sumSquares = 0;
    const data = this.timeDomainData;
    for (let i = 0; i < data.length; i += 1) {
      const centered = (data[i] - 128) / 128;
      sumSquares += centered * centered;
    }

    const rms = Math.sqrt(sumSquares / data.length);
    return Math.max(0, Math.min(1, (rms - 0.009) * 9.2));
  }
}
