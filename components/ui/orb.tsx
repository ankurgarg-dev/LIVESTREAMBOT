"use client";

import React from "react";
import * as THREE from "three";

type AgentState = null | "thinking" | "listening" | "talking";

type OrbProps = {
  colors?: [string, string];
  colorsRef?: React.RefObject<[string, string]>;
  resizeDebounce?: number;
  seed?: number;
  agentState?: AgentState;
  volumeMode?: "auto" | "manual";
  manualInput?: number;
  manualOutput?: number;
  inputVolumeRef?: React.RefObject<number>;
  outputVolumeRef?: React.RefObject<number>;
  getInputVolume?: () => number;
  getOutputVolume?: () => number;
  className?: string;
};

const DEFAULT_COLORS: [string, string] = ["#CADCFC", "#A0B9D1"];
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function resolveVolume(
  mode: "auto" | "manual",
  manualValue: number | undefined,
  refValue: React.RefObject<number> | undefined,
  getter: (() => number) | undefined,
): number {
  if (mode === "manual") return clamp01(manualValue ?? 0);
  if (getter) return clamp01(getter());
  if (refValue?.current != null) return clamp01(refValue.current);
  return clamp01(manualValue ?? 0);
}

export function Orb({
  colors = DEFAULT_COLORS,
  colorsRef,
  resizeDebounce = 100,
  seed = 1337,
  agentState = null,
  volumeMode = "auto",
  manualInput,
  manualOutput,
  inputVolumeRef,
  outputVolumeRef,
  getInputVolume,
  getOutputVolume,
  className,
}: OrbProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const runtimeRef = React.useRef({
    colors,
    colorsRef,
    agentState,
    volumeMode,
    manualInput,
    manualOutput,
    inputVolumeRef,
    outputVolumeRef,
    getInputVolume,
    getOutputVolume,
  });

  React.useEffect(() => {
    runtimeRef.current = {
      colors,
      colorsRef,
      agentState,
      volumeMode,
      manualInput,
      manualOutput,
      inputVolumeRef,
      outputVolumeRef,
      getInputVolume,
      getOutputVolume,
    };
  }, [
    colors,
    colorsRef,
    agentState,
    volumeMode,
    manualInput,
    manualOutput,
    inputVolumeRef,
    outputVolumeRef,
    getInputVolume,
    getOutputVolume,
  ]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    root.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 3.2);

    const group = new THREE.Group();
    scene.add(group);

    const sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 24),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(colors[0]),
        emissive: new THREE.Color(colors[1]),
        emissiveIntensity: 0.38,
        roughness: 0.14,
        metalness: 0.09,
      }),
    );
    group.add(sphere);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 48, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors[1]),
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(glow);

    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    const key = new THREE.PointLight(0x8cc8ff, 1.1, 18);
    key.position.set(2.2, 2.4, 2.4);
    const rim = new THREE.PointLight(0x6a88ff, 0.72, 16);
    rim.position.set(-2.6, -1.4, 1.8);
    scene.add(ambient, key, rim);

    let raf = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let t = (seed % 1000) / 1000;
    let smoothInput = 0;
    let smoothOutput = 0;

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, resizeDebounce);
    };

    resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(root);

    const animate = () => {
      raf = window.requestAnimationFrame(animate);
      t += 0.016;

      const current = runtimeRef.current;
      const pair = current.colorsRef?.current ?? current.colors;
      const base = new THREE.Color(pair[0]);
      const accent = new THREE.Color(pair[1]);

      const input = resolveVolume(
        current.volumeMode,
        current.manualInput,
        current.inputVolumeRef,
        current.getInputVolume,
      );
      const output = resolveVolume(
        current.volumeMode,
        current.manualOutput,
        current.outputVolumeRef,
        current.getOutputVolume,
      );
      smoothInput = THREE.MathUtils.lerp(smoothInput, input, 0.18);
      smoothOutput = THREE.MathUtils.lerp(smoothOutput, output, 0.18);

      const talking = current.agentState === "talking";
      const listening = current.agentState === "listening";
      const thinking = current.agentState === "thinking";
      const drive = talking ? smoothOutput : listening ? smoothInput : Math.max(smoothInput, smoothOutput) * 0.45;

      const pulseAmp = talking ? 0.16 : listening ? 0.09 : thinking ? 0.06 : 0.03;
      const pulseRate = talking ? 8.2 : listening ? 5.6 : thinking ? 3.6 : 2.2;
      const pulse = Math.sin(t * pulseRate) * pulseAmp;
      const scale = 1 + pulse + drive * (talking ? 0.26 : listening ? 0.16 : 0.08);
      group.scale.setScalar(scale);

      group.rotation.y += talking ? 0.018 : listening ? 0.011 : 0.006;
      group.rotation.x = Math.sin(t * 0.9) * 0.08 + (thinking ? Math.sin(t * 1.8) * 0.03 : 0);

      const mat = sphere.material as THREE.MeshStandardMaterial;
      mat.color.copy(base);
      mat.emissive.copy(accent);
      mat.emissiveIntensity = talking ? 0.74 + drive * 0.8 : listening ? 0.52 + drive * 0.46 : thinking ? 0.43 : 0.35;
      mat.roughness = talking ? 0.1 : listening ? 0.13 : 0.18;

      const glowMat = glow.material as THREE.MeshBasicMaterial;
      glowMat.color.copy(accent);
      glowMat.opacity = talking ? 0.2 + drive * 0.38 : listening ? 0.16 + drive * 0.24 : thinking ? 0.14 : 0.11;
      glow.scale.setScalar(1.06 + (talking ? drive * 0.28 : listening ? drive * 0.18 : 0.04));

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      window.cancelAnimationFrame(raf);
      root.removeChild(renderer.domElement);
      sphere.geometry.dispose();
      (sphere.material as THREE.Material).dispose();
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, [resizeDebounce, seed]);

  return <div ref={rootRef} className={className ?? "h-full w-full"} />;
}
