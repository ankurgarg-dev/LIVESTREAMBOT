"use client"

import { useEffect, useMemo, useRef } from "react"

export type AgentState = null | "thinking" | "listening" | "talking"

type OrbProps = {
  colors?: [string, string]
  colorsRef?: React.RefObject<[string, string]>
  resizeDebounce?: number
  seed?: number
  agentState?: AgentState
  volumeMode?: "auto" | "manual"
  manualInput?: number
  manualOutput?: number
  inputVolumeRef?: React.RefObject<number>
  outputVolumeRef?: React.RefObject<number>
  getInputVolume?: () => number
  getOutputVolume?: () => number
  className?: string
}

type Rgb = { r: number; g: number; b: number }

export function Orb({
  colors = ["#CADCFC", "#A0B9D1"],
  colorsRef,
  seed,
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  const stateRef = useRef<AgentState>(agentState)
  const modeRef = useRef<"auto" | "manual">(volumeMode)
  const inRef = useRef(0)
  const outRef = useRef(0)
  const tRef = useRef(0)

  const random = useMemo(
    () => splitmix32(seed ?? Math.floor(Math.random() * 2 ** 32)),
    [seed]
  )
  const phases = useMemo(
    () => Array.from({ length: 6 }, () => random() * Math.PI * 2),
    [random]
  )

  useEffect(() => {
    stateRef.current = agentState
  }, [agentState])

  useEffect(() => {
    modeRef.current = volumeMode
  }, [volumeMode])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    let last = performance.now()

    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.floor(host.clientWidth))
      const h = Math.max(1, Math.floor(host.clientHeight))
      const rw = Math.floor(w * dpr)
      const rh = Math.floor(h * dpr)
      if (canvas.width !== rw || canvas.height !== rh) {
        canvas.width = rw
        canvas.height = rh
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
    }

    sizeCanvas()
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(host)

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      tRef.current += dt

      const w = canvas.width
      const h = canvas.height
      const cx = w * 0.5
      const cy = h * 0.5
      const r = Math.min(w, h) * 0.46

      const liveColors = colorsRef?.current
      const c1 = hexToRgb(liveColors?.[0] || colors[0])
      const c2 = hexToRgb(liveColors?.[1] || colors[1])

      const t = tRef.current * 2
      let targetIn = 0
      let targetOut = 0.3
      if (modeRef.current === "manual") {
        targetIn = clamp01(
          manualInput ?? inputVolumeRef?.current ?? getInputVolume?.() ?? 0
        )
        targetOut = clamp01(
          manualOutput ?? outputVolumeRef?.current ?? getOutputVolume?.() ?? 0
        )
      } else {
        if (stateRef.current === null) {
          targetIn = 0
          targetOut = 0.3
        } else if (stateRef.current === "listening") {
          targetIn = clamp01(0.78 + Math.sin(t * 2.6) * 0.16)
          targetOut = clamp01(0.2 + Math.sin(t * 1.3) * 0.04)
        } else if (stateRef.current === "talking") {
          targetIn = clamp01(0.45 + Math.sin(t * 3.4) * 0.15)
          targetOut = clamp01(0.88 + Math.sin(t * 4.6) * 0.1)
        } else {
          const base = 0.38 + 0.07 * Math.sin(t * 0.7)
          const wander = 0.05 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1.2)
          targetIn = clamp01(base + wander)
          targetOut = clamp01(0.48 + 0.12 * Math.sin(t * 1.05 + 0.6))
        }
      }

      inRef.current += (targetIn - inRef.current) * 0.18
      outRef.current += (targetOut - outRef.current) * 0.18

      const mode = stateRef.current
      const behavior =
        mode === "talking"
          ? { pulseAmp: 0.18, pulseFreq: 2.6, drift: 1.8, blobGain: 1.35, ringAlpha: 0.26 }
          : mode === "listening"
            ? { pulseAmp: 0.08, pulseFreq: 1.2, drift: 0.7, blobGain: 0.95, ringAlpha: 0.12 }
            : { pulseAmp: 0.12, pulseFreq: 1.5, drift: 1, blobGain: 1, ringAlpha: 0.035 }
      const pulse =
        0.93 +
        outRef.current * behavior.pulseAmp +
        inRef.current * (mode === "listening" ? 0.035 : 0.01) +
        Math.sin(t * behavior.pulseFreq) * 0.014
      const isDark = document.documentElement.classList.contains("dark")

      ctx.clearRect(0, 0, w, h)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(pulse, pulse)
      ctx.translate(-cx, -cy)

      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()

      const bg = ctx.createRadialGradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r)
      bg.addColorStop(0, toRgba(lerpRgb(c1, white(), 0.24), isDark ? 0.9 : 1))
      bg.addColorStop(1, toRgba(lerpRgb(c2, black(), isDark ? 0.2 : 0.05), 1))
      ctx.fillStyle = bg
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)

      for (let i = 0; i < 6; i += 1) {
        const a = t * (0.6 + i * 0.12) * behavior.drift + phases[i]
        const rr =
          r * (0.22 + i * 0.04) * (0.72 + inRef.current * 0.72 * behavior.blobGain)
        const ox = Math.cos(a) * r * (0.18 + i * 0.06)
        const oy = Math.sin(a * 1.13) * r * (0.15 + i * 0.05)
        const bx = cx + ox
        const by = cy + oy

        const blob = ctx.createRadialGradient(bx, by, 0, bx, by, rr)
        const mix = i % 2 === 0 ? lerpRgb(c1, white(), 0.2) : lerpRgb(c2, white(), 0.18)
        blob.addColorStop(
          0,
          toRgba(
            mix,
            0.18 +
              outRef.current * (mode === "talking" ? 0.34 : 0.18) +
              inRef.current * (mode === "listening" ? 0.2 : 0.08)
          )
        )
        blob.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = blob
        ctx.fillRect(bx - rr, by - rr, rr * 2, rr * 2)
      }

      const shine = ctx.createLinearGradient(cx - r * 0.6, cy - r * 0.7, cx, cy)
      shine.addColorStop(0, "rgba(255,255,255,0.35)")
      shine.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = shine
      ctx.beginPath()
      ctx.ellipse(cx - r * 0.18, cy - r * 0.42, r * 0.42, r * 0.2, -0.3, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()

      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
      const idleWarmRing = mode === null
      ctx.lineWidth = idleWarmRing ? Math.max(1.1, r * 0.026) : Math.max(1.35, r * 0.032)
      ctx.strokeStyle = isDark
        ? idleWarmRing
          ? "rgba(252,222,15,0.2)"
          : `rgba(255,255,255,${0.055 + behavior.ringAlpha * 0.55})`
        : idleWarmRing
          ? "rgba(252,222,15,0.18)"
          : `rgba(0,0,0,${0.018 + behavior.ringAlpha * 0.24})`
      ctx.stroke()
      ctx.restore()

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [
    colors,
    colorsRef,
    getInputVolume,
    getOutputVolume,
    inputVolumeRef,
    manualInput,
    manualOutput,
    outputVolumeRef,
    phases,
  ])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  )
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function splitmix32(seed: number) {
  let x = seed >>> 0
  return () => {
    x = (x + 0x9e3779b9) >>> 0
    let z = x
    z = (z ^ (z >>> 16)) >>> 0
    z = Math.imul(z, 0x85ebca6b) >>> 0
    z = (z ^ (z >>> 13)) >>> 0
    z = Math.imul(z, 0xc2b2ae35) >>> 0
    z = (z ^ (z >>> 16)) >>> 0
    return z / 4294967296
  }
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, "")
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16)
    const g = parseInt(clean[1] + clean[1], 16)
    const b = parseInt(clean[2] + clean[2], 16)
    return { r, g, b }
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    return { r, g, b }
  }
  return { r: 200, g: 210, b: 230 }
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function toRgba(c: Rgb, a: number) {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp01(a)})`
}

function white(): Rgb {
  return { r: 255, g: 255, b: 255 }
}

function black(): Rgb {
  return { r: 0, g: 0, b: 0 }
}
