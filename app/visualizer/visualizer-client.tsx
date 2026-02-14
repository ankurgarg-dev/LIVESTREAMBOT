'use client';

import React from 'react';
import { VisualizerManager } from '@/visualizer/VisualizerManager';
import { OrbVisualizer } from '@/visualizer/OrbVisualizer';
import { WaveformVisualizer } from '@/visualizer/WaveformVisualizer';
import { ParticleHaloVisualizer } from '@/visualizer/ParticleHaloVisualizer';
import { EqualizerVisualizer } from '@/visualizer/EqualizerVisualizer';
import styles from './visualizer.module.css';

const DEFAULT_TTS_URL =
  'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8fa966286.mp3?filename=soft-piano-logo-113318.mp3';

export function VisualizerClient() {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const managerRef = React.useRef<VisualizerManager | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const sourceNodeRef = React.useRef<MediaElementAudioSourceNode | null>(null);

  const [style, setStyle] = React.useState('orb');
  const [ttsUrl, setTtsUrl] = React.useState(DEFAULT_TTS_URL);
  const [canPlay, setCanPlay] = React.useState(false);

  React.useEffect(() => {
    if (!containerRef.current) return;

    const manager = new VisualizerManager(containerRef.current);
    manager.register('orb', OrbVisualizer);
    manager.register('waveform', WaveformVisualizer);
    manager.register('particle-halo', ParticleHaloVisualizer);
    manager.register('equalizer', EqualizerVisualizer);
    manager.switch('orb');
    manager.setState('idle');
    managerRef.current = manager;

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = DEFAULT_TTS_URL;
    audioRef.current = audio;

    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaElementSource(audio);
    audioCtxRef.current = audioContext;
    sourceNodeRef.current = sourceNode;
    manager.connectAudio(audioContext, sourceNode);

    audio.onplay = () => manager.setState('speaking');
    audio.onended = () => manager.setState('idle');
    audio.onpause = () => {
      if (!audio.ended) manager.setState('idle');
    };

    setCanPlay(true);

    return () => {
      audio.pause();
      audio.src = '';
      manager.destroy();
      sourceNode.disconnect();
      audioContext.close().catch(() => undefined);
      managerRef.current = null;
      audioRef.current = null;
      audioCtxRef.current = null;
      sourceNodeRef.current = null;
    };
  }, []);

  const onSwitchStyle = React.useCallback(
    (nextStyle: string) => {
      setStyle(nextStyle);
      managerRef.current?.switch(nextStyle);
    },
    [setStyle],
  );

  const onPlay = React.useCallback(async () => {
    if (!audioRef.current || !audioCtxRef.current) return;
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    audioRef.current.src = ttsUrl.trim() || DEFAULT_TTS_URL;
    managerRef.current?.setState('thinking');
    await audioRef.current.play();
  }, [ttsUrl]);

  const onStop = React.useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    managerRef.current?.setState('idle');
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.visualPane}>
          <div ref={containerRef} className={styles.visualizer} />
        </div>
        <aside className={styles.panel}>
          <h1 className={styles.title}>Bristlecone Visualizer</h1>
          <label className={styles.label} htmlFor="style">
            Style
          </label>
          <select
            id="style"
            className={styles.input}
            value={style}
            onChange={(e) => onSwitchStyle(e.target.value)}
          >
            <option value="orb">orb</option>
            <option value="waveform">waveform</option>
            <option value="particle-halo">particle-halo</option>
            <option value="equalizer">equalizer</option>
          </select>

          <label className={styles.label} htmlFor="tts-url">
            TTS URL
          </label>
          <input
            id="tts-url"
            className={styles.input}
            type="text"
            value={ttsUrl}
            onChange={(e) => setTtsUrl(e.target.value)}
          />

          <div className={styles.row}>
            <button className={styles.button} type="button" onClick={onPlay} disabled={!canPlay}>
              Play / Speak
            </button>
            <button className={styles.button} type="button" onClick={onStop} disabled={!canPlay}>
              Stop
            </button>
          </div>
          <div className={styles.row}>
            <button
              className={styles.button}
              type="button"
              onClick={() => managerRef.current?.setState('thinking')}
            >
              Set Thinking
            </button>
            <button
              className={styles.button}
              type="button"
              onClick={() => managerRef.current?.setState('idle')}
            >
              Set Idle
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

