import * as THREE from 'three';
import type { VisualizerState, VoiceVisualizer } from './VoiceVisualizer';

const BRAND_COLORS = {
  primary: '#21A6BD',
  secondary: '#4BC984',
  accent: '#45AFC2',
  dark: '#192123',
  neutral: '#7F7F7F',
} as const;

const LERP_FACTOR = 0.14;

function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export class OrbVisualizer implements VoiceVisualizer {
  private container?: HTMLElement;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private orbMesh?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private ambientLight?: THREE.AmbientLight;
  private pointLight?: THREE.PointLight;
  private rafId = 0;
  private startTime = 0;

  private state: VisualizerState = 'idle';
  private currentScale = 1;
  private currentGlow = 0.55;
  private currentDisplacement = 0;
  private smoothedAmplitude = 0;

  private analyser?: AnalyserNode;
  private silentGain?: GainNode;
  private audioContext?: AudioContext;
  private sourceNode?: AudioNode;
  private timeDomainData?: Uint8Array<ArrayBuffer>;
  private audioConnected = false;

  private basePositions?: Float32Array;
  private gradientTexture?: THREE.CanvasTexture;
  private resizeObserver?: ResizeObserver;

  private readonly tempColorA = new THREE.Color(BRAND_COLORS.primary);
  private readonly tempColorB = new THREE.Color(BRAND_COLORS.secondary);
  private readonly tempColorC = new THREE.Color(BRAND_COLORS.accent);

  init(container: HTMLElement): void {
    this.container = container;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(BRAND_COLORS.dark, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    const point = new THREE.PointLight(0x75cad4, 1.15, 20);
    point.position.set(2.1, 1.8, 3.2);
    scene.add(ambient, point);
    this.ambientLight = ambient;
    this.pointLight = point;

    const texture = this.createGradientTexture();
    this.gradientTexture = texture;

    const geometry = new THREE.SphereGeometry(1, 72, 72);
    const position = geometry.attributes.position.array as Float32Array;
    this.basePositions = new Float32Array(position.length);
    this.basePositions.set(position);

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.33,
      metalness: 0.21,
      emissive: new THREE.Color(BRAND_COLORS.accent),
      emissiveIntensity: this.currentGlow,
    });

    const orb = new THREE.Mesh(geometry, material);
    orb.position.set(0, 0, 0);
    scene.add(orb);
    this.orbMesh = orb;

    this.attachResizeHandling(container);
    this.onResize();

    this.startTime = performance.now() * 0.001;
    this.animate();
  }

  connectAudio(audioContext: AudioContext, sourceNode: AudioNode): void {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // Ignore if node is already disconnected.
      }
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {
        // Ignore if node is already disconnected.
      }
      this.silentGain = undefined;
    }

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
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

    if (this.orbMesh) {
      this.orbMesh.geometry.dispose();
      this.orbMesh.material.dispose();
    }

    this.gradientTexture?.dispose();
    this.gradientTexture = undefined;

    this.renderer?.dispose();

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // Ignore if node is already disconnected.
      }
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {
        // Ignore if node is already disconnected.
      }
    }

    this.scene = undefined;
    this.camera = undefined;
    this.renderer = undefined;
    this.orbMesh = undefined;
    this.ambientLight = undefined;
    this.pointLight = undefined;
    this.basePositions = undefined;
    this.analyser = undefined;
    this.silentGain = undefined;
    this.timeDomainData = undefined;
    this.container = undefined;
    this.audioConnected = false;
  }

  private createGradientTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create 2D context for orb gradient texture');
    }

    const gradient = ctx.createLinearGradient(0, 0, 512, 512);
    gradient.addColorStop(0, BRAND_COLORS.primary);
    gradient.addColorStop(0.6, BRAND_COLORS.secondary);
    gradient.addColorStop(1, BRAND_COLORS.accent);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private attachResizeHandling(container: HTMLElement): void {
    const observer = new ResizeObserver(() => this.onResize());
    observer.observe(container);
    this.resizeObserver = observer;
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
    if (!this.orbMesh || !this.basePositions) return;

    const elapsed = nowSeconds - this.startTime;
    const amplitude = this.getAmplitude();
    this.smoothedAmplitude = lerp(this.smoothedAmplitude, amplitude, LERP_FACTOR);

    let targetScale = 1.0;
    let targetGlow = 0.5;
    let targetDisplacement = 0.0;
    let colorMix = 0.0;

    if (this.state === 'idle') {
      targetScale = 1 + Math.sin(elapsed * 1.1) * 0.022;
      targetGlow = 0.48;
      targetDisplacement = 0.005;
    } else if (this.state === 'thinking') {
      targetScale = 1 + Math.sin(elapsed * 2.0) * 0.034;
      targetGlow = 0.72 + Math.sin(elapsed * 1.4) * 0.1;
      targetDisplacement = 0.012;
      colorMix = (Math.sin(elapsed * 1.5) + 1) * 0.5;
    } else {
      targetScale = 1.01 + this.smoothedAmplitude * 0.22;
      targetGlow = 0.7 + this.smoothedAmplitude * 1.55;
      targetDisplacement = 0.012 + this.smoothedAmplitude * 0.14;
      colorMix = 0.18 + this.smoothedAmplitude * 0.45;
    }

    this.currentScale = lerp(this.currentScale, targetScale, 0.17);
    this.currentGlow = lerp(this.currentGlow, targetGlow, 0.14);
    this.currentDisplacement = lerp(this.currentDisplacement, targetDisplacement, 0.16);

    this.orbMesh.scale.setScalar(this.currentScale);
    this.applyDisplacement(elapsed, this.currentDisplacement);

    const material = this.orbMesh.material;
    material.emissive.copy(this.tempColorC).lerp(this.tempColorA, 0.35).lerp(this.tempColorB, colorMix);
    material.emissiveIntensity = this.currentGlow;
    material.needsUpdate = false;
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
    const normalized = Math.max(0, Math.min(1, (rms - 0.015) * 6.2));
    return normalized;
  }

  private applyDisplacement(elapsed: number, intensity: number): void {
    if (!this.orbMesh || !this.basePositions) return;

    const geometry = this.orbMesh.geometry;
    const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
    const position = positionAttr.array as Float32Array;
    const base = this.basePositions;

    for (let i = 0; i < position.length; i += 3) {
      const x = base[i];
      const y = base[i + 1];
      const z = base[i + 2];

      const noiseA = Math.sin(x * 3.9 + elapsed * 2.2) * 0.35;
      const noiseB = Math.sin(y * 4.4 - elapsed * 1.8) * 0.33;
      const noiseC = Math.sin(z * 5.1 + elapsed * 2.6) * 0.32;
      const offset = (noiseA + noiseB + noiseC) * intensity;

      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      const nx = x / len;
      const ny = y / len;
      const nz = z / len;

      position[i] = x + nx * offset;
      position[i + 1] = y + ny * offset;
      position[i + 2] = z + nz * offset;
    }

    positionAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}
