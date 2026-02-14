import type { VisualizerState, VoiceVisualizer } from './VoiceVisualizer';

export class WaveformVisualizer implements VoiceVisualizer {
  protected container?: HTMLElement;
  protected state: VisualizerState = 'idle';

  init(container: HTMLElement): void {
    this.container = container;
    this.container.textContent = '';
  }

  connectAudio(_audioContext: AudioContext, _sourceNode: AudioNode): void {
    // Scaffold only: waveform style implementation will be added later.
  }

  setState(state: VisualizerState): void {
    this.state = state;
  }

  destroy(): void {
    if (this.container) {
      this.container.textContent = '';
    }
    this.container = undefined;
  }
}

