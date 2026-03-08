'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentState, Orb } from '@/components/ui/orb';
import styles from './page.module.css';

type VoiceMode = 'idle' | 'connecting' | 'listening' | 'thinking' | 'talking';
type VisualMode = 'ribbon' | 'orb';

const BRAND_COLORS: [string, string] = ['#21A6BD', '#4BC984'];

export default function OrbVoiceTestPage() {
  const router = useRouter();
  const [mode, setMode] = useState<VoiceMode>('idle');
  const [visualMode, setVisualMode] = useState<VisualMode>('ribbon');
  const [error, setError] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [hasMicPermission, setHasMicPermission] = useState(false);

  const inputVolumeRef = useRef(0);
  const outputVolumeRef = useRef(0.16);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputFrameRef = useRef<number | null>(null);
  const speakingFrameRef = useRef<number | null>(null);
  const thinkTimerRef = useRef<number | null>(null);
  const speakingStartedAtRef = useRef<number>(0);
  const hasLiveMicRef = useRef(false);

  const agentState: AgentState = useMemo(() => {
    if (mode === 'thinking') return 'thinking';
    if (mode === 'talking') return 'talking';
    if (mode === 'connecting' || mode === 'listening') return 'listening';
    return null;
  }, [mode]);
  const voiceEnergy = useMemo(() => Math.min(1, inputLevel * 0.9 + outputLevel * 1.1), [inputLevel, outputLevel]);
  const waveBars = useMemo(
    () =>
      Array.from({ length: 19 }, (_, index) => {
        const pivot = Math.abs(index - 9);
        const centerBias = 1 - pivot / 10;
        const wobble = Math.sin(performance.now() * 0.0035 + index * 0.85) * 0.14;
        const level = Math.max(0.06, Math.min(1, centerBias * (0.22 + voiceEnergy * 0.92 + wobble)));
        return {
          id: index,
          scale: level,
          delay: index * 0.035,
        };
      }),
    [voiceEnergy],
  );
  const ribbonBars = useMemo(
    () =>
      Array.from({ length: 33 }, (_, index) => {
        const pivot = Math.abs(index - 16);
        const centerBias = 1 - pivot / 17;
        const wobble = Math.sin(performance.now() * 0.0048 + index * 0.62) * 0.18;
        const base = mode === 'idle' ? 0.06 : mode === 'thinking' ? 0.12 : 0.2;
        const level = Math.max(0.08, Math.min(1, centerBias * (base + voiceEnergy * 1.05 + wobble)));
        return { id: index, scale: level, delay: index * 0.02 };
      }),
    [mode, voiceEnergy],
  );

  const stopThinkingTimer = useCallback(() => {
    if (thinkTimerRef.current !== null) {
      window.clearTimeout(thinkTimerRef.current);
      thinkTimerRef.current = null;
    }
  }, []);

  const stopAssistantSpeaking = useCallback(() => {
    if (speakingFrameRef.current !== null) {
      cancelAnimationFrame(speakingFrameRef.current);
      speakingFrameRef.current = null;
    }
    outputVolumeRef.current = hasLiveMicRef.current ? 0.12 : 0.16;
    setOutputLevel(outputVolumeRef.current);
  }, []);

  const stopMic = useCallback(() => {
    if (inputFrameRef.current !== null) {
      cancelAnimationFrame(inputFrameRef.current);
      inputFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    hasLiveMicRef.current = false;
    inputVolumeRef.current = 0;
    setInputLevel(0);
    outputVolumeRef.current = 0.16;
    setOutputLevel(0.16);
  }, []);

  const stopAll = useCallback(() => {
    stopThinkingTimer();
    stopAssistantSpeaking();
    stopMic();
    setMode('idle');
  }, [stopAssistantSpeaking, stopMic, stopThinkingTimer]);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  const startMicLoop = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.fftSize);
    let smoothed = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const centered = (data[i] - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      const normalized = Math.min(1, rms * 4.2);
      smoothed += (normalized - smoothed) * 0.22;
      inputVolumeRef.current = smoothed;
      setInputLevel(smoothed);
      inputFrameRef.current = requestAnimationFrame(tick);
    };
    inputFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    stopThinkingTimer();
    stopAssistantSpeaking();
    stopMic();
    setMode('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);

      micStreamRef.current = stream;
      audioContextRef.current = audioContext;
      hasLiveMicRef.current = true;
      outputVolumeRef.current = 0.12;
      setOutputLevel(0.12);
      setHasMicPermission(true);
      setMode('listening');
      startMicLoop(analyser);
    } catch {
      setMode('idle');
      setHasMicPermission(false);
      setError('Microphone access was denied. Allow mic permission and try again.');
    }
  }, [startMicLoop, stopAssistantSpeaking, stopMic, stopThinkingTimer]);

  const runAssistantSpeaking = useCallback(() => {
    speakingStartedAtRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - speakingStartedAtRef.current) / 1000;
      if (elapsed > 5.4) {
        stopAssistantSpeaking();
        setMode(hasLiveMicRef.current ? 'listening' : 'idle');
        return;
      }
      const phrase = Math.sin(elapsed * 9.8) * Math.sin(elapsed * 3.7 + 0.6);
      const pulse = Math.max(0, phrase);
      const jitter = Math.max(0, Math.sin(elapsed * 24.0 + 1.1)) * 0.08;
      const envelope = 0.22 + pulse * 0.64 + jitter;
      outputVolumeRef.current = Math.min(1, envelope);
      setOutputLevel(outputVolumeRef.current);
      speakingFrameRef.current = requestAnimationFrame(tick);
    };
    speakingFrameRef.current = requestAnimationFrame(tick);
  }, [stopAssistantSpeaking]);

  const simulateReply = useCallback(() => {
    stopThinkingTimer();
    stopAssistantSpeaking();
    setMode('thinking');
    thinkTimerRef.current = window.setTimeout(() => {
      setMode('talking');
      runAssistantSpeaking();
    }, 620);
  }, [runAssistantSpeaking, stopAssistantSpeaking, stopThinkingTimer]);

  return (
    <main className={styles.main}>
      <section className={styles.shell}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Voice UI Prototype</p>
          <h1>Orb Voice Test</h1>
          <p className={styles.subhead}>Single-orb voice surface with live mic and assistant-response animation.</p>
          <div className={styles.visualToggle}>
            <button
              type="button"
              className="lk-button"
              onClick={() => setVisualMode('ribbon')}
              aria-pressed={visualMode === 'ribbon'}
            >
              Ribbon
            </button>
            <button
              type="button"
              className="lk-button"
              onClick={() => setVisualMode('orb')}
              aria-pressed={visualMode === 'orb'}
            >
              Orb
            </button>
          </div>
        </div>

        <div className={styles.orbStage} data-agent={agentState ?? 'idle'} data-visual={visualMode}>
          {visualMode === 'orb' ? (
            <>
              <div className={styles.spectralRingA} aria-hidden="true" />
              <div className={styles.spectralRingB} aria-hidden="true" />
              <div className={styles.aura} aria-hidden="true" />
              <div className={styles.orbFrame}>
                <Orb
                  colors={BRAND_COLORS}
                  seed={4242}
                  agentState={agentState}
                  volumeMode="manual"
                  inputVolumeRef={inputVolumeRef}
                  outputVolumeRef={outputVolumeRef}
                />
              </div>
              <div className={styles.waveStrip} aria-hidden="true">
                {waveBars.map((bar) => (
                  <span
                    key={bar.id}
                    className={styles.waveBar}
                    style={
                      {
                        transform: `scaleY(${bar.scale.toFixed(4)})`,
                        animationDelay: `${bar.delay}s`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <div className={styles.ribbonScene} aria-hidden="true">
              <div className={styles.ribbonGlow} />
              <div className={styles.ribbonCore} />
              <div className={styles.ribbonStrip}>
                {ribbonBars.map((bar) => (
                  <span
                    key={bar.id}
                    className={styles.ribbonBar}
                    style={
                      {
                        transform: `scaleY(${bar.scale.toFixed(4)})`,
                        animationDelay: `${bar.delay}s`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            </div>
          )}
          <div className={styles.readout} aria-live="polite">
            <span className={styles.modeTag}>{mode}</span>
            <span className={styles.levelText}>input {Math.round(inputLevel * 100)}%</span>
            <span className={styles.levelText}>output {Math.round(outputLevel * 100)}%</span>
          </div>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className="lk-button"
            onClick={startListening}
            disabled={mode === 'connecting'}
          >
            {hasMicPermission ? 'Reconnect Mic' : 'Start Listening'}
          </button>
          <button
            type="button"
            className="lk-button"
            onClick={simulateReply}
            disabled={mode === 'connecting'}
          >
            Simulate Reply
          </button>
          <button type="button" className="lk-button" onClick={stopAll}>
            End
          </button>
          <button type="button" className="lk-button" onClick={() => router.push('/orb-test')}>
            Back to Orb Test
          </button>
          <button type="button" className="lk-button" onClick={() => router.push('/?tab=dashboard')}>
            Back to Dashboard
          </button>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
    </main>
  );
}
