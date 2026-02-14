import { VisualizerManager } from './visualizer/VisualizerManager';
import { OrbVisualizer } from './visualizer/OrbVisualizer';
import { WaveformVisualizer } from './visualizer/WaveformVisualizer';
import { ParticleHaloVisualizer } from './visualizer/ParticleHaloVisualizer';
import { EqualizerVisualizer } from './visualizer/EqualizerVisualizer';

const visualizerContainer = document.getElementById('visualizer');
const styleSelect = document.getElementById('style-select') as HTMLSelectElement | null;
const ttsInput = document.getElementById('tts-url') as HTMLInputElement | null;
const playButton = document.getElementById('play-btn') as HTMLButtonElement | null;
const stopButton = document.getElementById('stop-btn') as HTMLButtonElement | null;
const thinkingButton = document.getElementById('thinking-btn') as HTMLButtonElement | null;
const idleButton = document.getElementById('idle-btn') as HTMLButtonElement | null;

if (!visualizerContainer || !styleSelect || !ttsInput || !playButton || !stopButton) {
  throw new Error('Missing required DOM elements for visualizer demo');
}

const manager = new VisualizerManager(visualizerContainer);
manager.register('orb', OrbVisualizer);
manager.register('waveform', WaveformVisualizer);
manager.register('particle-halo', ParticleHaloVisualizer);
manager.register('equalizer', EqualizerVisualizer);
manager.switch('orb');

styleSelect.innerHTML = manager
  .listStyles()
  .map((style) => `<option value="${style}">${style}</option>`)
  .join('');

const ttsStreamUrl = ttsInput.value.trim();
const audio = new Audio();
audio.src = ttsStreamUrl;
audio.crossOrigin = 'anonymous';
audio.preload = 'auto';

const audioContext = new AudioContext();
const source = audioContext.createMediaElementSource(audio);

// Example integration with LiveKit + TTS stream playback.
manager.connectAudio(audioContext, source);
manager.setState('thinking');
audio.onplay = () => manager.setState('speaking');
audio.onended = () => manager.setState('idle');
audio.onpause = () => {
  if (audio.ended) return;
  manager.setState('idle');
};

styleSelect.addEventListener('change', () => {
  manager.switch(styleSelect.value);
});

playButton.addEventListener('click', async () => {
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const nextUrl = ttsInput.value.trim();
  if (nextUrl && audio.src !== nextUrl) {
    audio.src = nextUrl;
  }

  manager.setState('thinking');
  await audio.play();
});

stopButton.addEventListener('click', () => {
  audio.pause();
  audio.currentTime = 0;
  manager.setState('idle');
});

thinkingButton?.addEventListener('click', () => manager.setState('thinking'));
idleButton?.addEventListener('click', () => manager.setState('idle'));

window.addEventListener('beforeunload', () => {
  manager.destroy();
  audio.pause();
  audio.src = '';
});

