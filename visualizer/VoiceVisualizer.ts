export type VisualizerState = 'idle' | 'thinking' | 'speaking';

export interface VoiceVisualizer {
  init(container: HTMLElement): void;
  connectAudio(audioContext: AudioContext, sourceNode: AudioNode): void;
  setState(state: VisualizerState): void;
  destroy(): void;
}

