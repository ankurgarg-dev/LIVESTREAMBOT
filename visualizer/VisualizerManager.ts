import type { VoiceVisualizer } from './VoiceVisualizer';

type VisualizerCtor = new () => VoiceVisualizer;

export class VisualizerManager {
  private readonly styles = new Map<string, VisualizerCtor>();
  private current?: VoiceVisualizer;
  private currentStyle?: string;
  private container?: HTMLElement;
  private audioContext?: AudioContext;
  private sourceNode?: AudioNode;

  constructor(container?: HTMLElement) {
    this.container = container;
  }

  setContainer(container: HTMLElement): void {
    this.container = container;
    if (this.current) {
      this.current.destroy();
      this.current = undefined;
      const style = this.currentStyle;
      this.currentStyle = undefined;
      if (style) {
        this.switch(style);
      }
    }
  }

  register(name: string, ctor: VisualizerCtor): void {
    this.styles.set(name, ctor);
  }

  listStyles(): string[] {
    return Array.from(this.styles.keys());
  }

  switch(name: string): void {
    const Ctor = this.styles.get(name);
    if (!Ctor) {
      throw new Error(`Visualizer style '${name}' is not registered`);
    }
    if (!this.container) {
      throw new Error('Visualizer container is not set');
    }

    if (this.current) {
      this.current.destroy();
      this.current = undefined;
    }

    const visualizer = new Ctor();
    visualizer.init(this.container);

    if (this.audioContext && this.sourceNode) {
      visualizer.connectAudio(this.audioContext, this.sourceNode);
    }

    this.current = visualizer;
    this.currentStyle = name;
  }

  connectAudio(audioContext: AudioContext, sourceNode: AudioNode): void {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    if (this.current) {
      this.current.connectAudio(audioContext, sourceNode);
    }
  }

  setState(state: 'idle' | 'thinking' | 'speaking'): void {
    this.current?.setState(state);
  }

  destroy(): void {
    if (this.current) {
      this.current.destroy();
      this.current = undefined;
    }
    this.currentStyle = undefined;
  }
}

