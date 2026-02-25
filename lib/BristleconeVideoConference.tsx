'use client';

import * as React from 'react';
import {
  AudioTrack,
  CarouselLayout,
  Chat,
  ConnectionQualityIndicator,
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantName,
  ParticipantTile,
  RoomAudioRenderer,
  TrackMutedIndicator,
  VideoTrack,
  isTrackReference,
  useCreateLayoutContext,
  useIsSpeaking,
  useIsRecording,
  useLocalParticipant,
  useMaybeTrackRefContext,
  usePinnedTracks,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
  type MessageFormatter,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { RoomEvent, Track, type LocalAudioTrack, type Participant, type RemoteAudioTrack } from 'livekit-client';
import { VisualizerManager } from '@/visualizer/VisualizerManager';
import { OrbVisualizer } from '@/visualizer/OrbVisualizer';
import { WaveformVisualizer } from '@/visualizer/WaveformVisualizer';
import { ParticleHaloVisualizer } from '@/visualizer/ParticleHaloVisualizer';
import { EqualizerVisualizer } from '@/visualizer/EqualizerVisualizer';
import type { VisualizerState } from '@/visualizer/VoiceVisualizer';
import { LiquidGlassOrb } from '@/lib/realtime/LiquidGlassOrb';
const RECORDING_ENDPOINT = process.env.NEXT_PUBLIC_LK_RECORD_ENDPOINT ?? '/api/record';

export interface BristleconeVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  SettingsComponent?: React.ComponentType;
  isModerator?: boolean;
}

type AgentOrbVariant = 'classic' | 'realtime_screening';
type AgentTransportMode = 'realtime_ws' | 'direct_client' | 'turn_based' | 'unknown';
type AgentMediaMode = 'direct' | 'relay' | 'unknown';
type AgentAssistantState = 'idle' | 'thinking' | 'speaking' | 'unknown';

function isRoomDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debugRoom') === '1' || params.get('debug') === 'room') return true;
    if (window.localStorage.getItem('bc_debug_room') === '1') return true;
  } catch {
    // Ignore URL/localStorage access failures.
  }
  return false;
}

function roomDebugLog(enabled: boolean, event: string, payload?: unknown) {
  if (!enabled) return;
  const ts = new Date().toISOString();
  if (payload === undefined) {
    console.info(`[bc-room-debug] ${ts} ${event}`);
    return;
  }
  console.info(`[bc-room-debug] ${ts} ${event}`, payload);
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ControlBarRecordingExtras({
  showSettings,
  isModerator,
  isInterviewPaused,
  onTogglePause,
}: {
  showSettings: boolean;
  isModerator: boolean;
  isInterviewPaused: boolean;
  onTogglePause: () => Promise<void>;
}) {
  const room = useRoomContext();
  const isRecording = useIsRecording();
  const [isToggling, setIsToggling] = React.useState(false);
  const [isPauseBusy, setIsPauseBusy] = React.useState(false);
  const [meetingStartedAt, setMeetingStartedAt] = React.useState<number>(() => Date.now());
  const [meetingElapsedSec, setMeetingElapsedSec] = React.useState(0);

  React.useEffect(() => {
    const resetStart = () => setMeetingStartedAt(Date.now());
    room.on(RoomEvent.Connected, resetStart);
    return () => {
      room.off(RoomEvent.Connected, resetStart);
    };
  }, [room]);

  React.useEffect(() => {
    const tick = () => {
      setMeetingElapsedSec(Math.max(0, Math.floor((Date.now() - meetingStartedAt) / 1000)));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [meetingStartedAt]);

  const toggleRecording = async () => {
    if (room.isE2EEEnabled || isToggling) return;
    setIsToggling(true);
    const endpoint = isRecording ? 'stop' : 'start';
    try {
      const response = await fetch(
        `${RECORDING_ENDPOINT}/${endpoint}?roomName=${encodeURIComponent(room.name)}`,
        { method: 'POST', keepalive: true },
      );
      if (!response.ok && response.status !== 404 && response.status !== 409) {
        const details = await response.text().catch(() => response.statusText);
        console.error(`[recording] ${endpoint} failed:`, response.status, details);
      }
    } catch (error) {
      console.error(`[recording] ${endpoint} failed:`, error);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="bc-controlbar-row">
      <div className="bc-controlbar-side left">
        <div className="bc-controlbar-timer">{formatDuration(meetingElapsedSec)}</div>
      </div>
      <ControlBar controls={{ chat: true, settings: showSettings }} />
      <div className="bc-controlbar-side right">
        <button
          type="button"
          className={`lk-button bc-controlbar-record-toggle ${isRecording ? 'is-recording' : ''}`}
          disabled={isToggling || room.isE2EEEnabled}
          onClick={toggleRecording}
        >
          {isToggling ? 'Please wait...' : isRecording ? 'Stop Rec' : 'Start Rec'}
        </button>
        {isModerator ? (
          <button
            type="button"
            className={`lk-button bc-controlbar-pause-toggle ${isInterviewPaused ? 'is-paused' : ''}`}
            disabled={isPauseBusy}
            onClick={async () => {
              setIsPauseBusy(true);
              try {
                await onTogglePause();
              } finally {
                setIsPauseBusy(false);
              }
            }}
          >
            {isPauseBusy ? 'Please wait...' : isInterviewPaused ? 'Resume Interview' : 'Pause Interview'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function isAgentParticipant(participant?: Participant): boolean {
  if (!participant) return false;
  const kind = String(participant.kind ?? '').toLowerCase();
  if (kind === 'agent') return true;
  const probe = `${participant.identity} ${participant.name ?? ''}`.toLowerCase();
  return (
    probe.includes('bristlecone') ||
    probe.includes('bristlecone-ai-agent') ||
    probe.includes('bot') ||
    probe.includes('agent') ||
    probe.includes('assistant') ||
    probe.includes(' ai ')
  );
}

function getAgentOrbVariant(participant?: Participant): AgentOrbVariant {
  if (!participant) return 'classic';
  const probe = `${participant.identity} ${participant.name ?? ''}`.toLowerCase();
  if (
    probe.includes('-rt-') ||
    probe.includes('realtime') ||
    probe.includes('screening')
  ) {
    return 'realtime_screening';
  }
  return 'classic';
}

function sameTrackRef(
  a: TrackReferenceOrPlaceholder | undefined,
  b: TrackReferenceOrPlaceholder | undefined,
): boolean {
  if (!a || !b) return false;
  if (isTrackReference(a) && isTrackReference(b)) {
    return a.publication.trackSid === b.publication.trackSid;
  }
  return a.participant.identity === b.participant.identity && a.source === b.source;
}

function toTrackRef(participant: Participant, source: Track.Source): TrackReference | undefined {
  const publication = participant.getTrackPublication(source);
  if (!publication?.track) return undefined;
  return {
    participant,
    publication,
    source,
  };
}

function AgentOrbOverlay({
  participant,
  localParticipant,
  variant,
  paused = false,
  agentTransportMode = 'unknown',
  agentAssistantState = 'unknown',
}: {
  participant: Participant;
  localParticipant?: Participant;
  variant: AgentOrbVariant;
  paused?: boolean;
  agentTransportMode?: AgentTransportMode;
  agentAssistantState?: AgentAssistantState;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const liquidCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const liquidEngineRef = React.useRef<LiquidGlassOrb | null>(null);
  const managerRef = React.useRef<VisualizerManager | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const mixRef = React.useRef<GainNode | null>(null);
  const remoteSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const localSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const connectionSignatureRef = React.useRef<string | null>(null);
  const lastLocalSpeakingRef = React.useRef(false);
  const thinkingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visualState, setVisualState] = React.useState<VisualizerState>('idle');
  const interruptedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [interruptedActive, setInterruptedActive] = React.useState(false);
  const [processingActive, setProcessingActive] = React.useState(false);
  const [realtimeState, setRealtimeState] = React.useState<
    | 'idle'
    | 'listening'
    | 'processing'
    | 'speaking'
    | 'interrupted'
    | 'paused'
    | 'reconnecting'
    | 'error'
    | 'completed'
    | 'muted_or_no_mic'
  >('idle');
  const wasAgentSpeakingRef = React.useRef(false);
  const wasLocalSpeakingRealtimeRef = React.useRef(false);

  const isSpeaking = useIsSpeaking(participant);
  const localIsSpeaking = useIsSpeaking(localParticipant);
  const remoteAudioLevel = Math.max(0, Math.min(1, Number((participant as Participant & { audioLevel?: number })?.audioLevel || 0)));
  const localAudioLevel = Math.max(
    0,
    Math.min(1, Number((localParticipant as Participant & { audioLevel?: number } | undefined)?.audioLevel || 0)),
  );
  const localMicPub = localParticipant?.getTrackPublication(Track.Source.Microphone);
  const micUnavailable = Boolean(localParticipant) && (!localMicPub || localMicPub.isMuted || !localMicPub.track);

  React.useEffect(() => {
    if (variant === 'realtime_screening') {
      return () => {
        liquidEngineRef.current?.stop();
        liquidEngineRef.current = null;
        if (thinkingTimeoutRef.current) {
          clearTimeout(thinkingTimeoutRef.current);
          thinkingTimeoutRef.current = null;
        }
        if (interruptedTimeoutRef.current) {
          clearTimeout(interruptedTimeoutRef.current);
          interruptedTimeoutRef.current = null;
        }
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
      };
    }
    if (!containerRef.current) return;

    const manager = new VisualizerManager(containerRef.current);
    manager.register('orb', OrbVisualizer);
    manager.register('waveform', WaveformVisualizer);
    manager.register('particle-halo', ParticleHaloVisualizer);
    manager.register('equalizer', EqualizerVisualizer);
    manager.switch('particle-halo');
    manager.setState('idle');
    managerRef.current = manager;

    return () => {
      manager.destroy();
      managerRef.current = null;
      try {
        remoteSourceRef.current?.disconnect();
        localSourceRef.current?.disconnect();
        mixRef.current?.disconnect();
      } catch {
        // Ignore disconnect errors during unmount.
      }
      remoteSourceRef.current = null;
      localSourceRef.current = null;
      mixRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
      }
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }
      audioContextRef.current = null;
      connectionSignatureRef.current = null;
    };
  }, [variant]);

  React.useEffect(() => {
    if (variant !== 'realtime_screening') return;
    if (!liquidCanvasRef.current) return;

    const engine = new LiquidGlassOrb(liquidCanvasRef.current);
    liquidEngineRef.current = engine;
    engine.start();
    const ro = new ResizeObserver(() => {
      engine.resize();
    });
    ro.observe(liquidCanvasRef.current);

    return () => {
      ro.disconnect();
      engine.stop();
      if (liquidEngineRef.current === engine) liquidEngineRef.current = null;
    };
  }, [variant]);

  React.useEffect(() => {
    if (variant !== 'realtime_screening') return;
    liquidEngineRef.current?.setState(realtimeState, realtimeState === 'interrupted' ? 220 : 420);
  }, [realtimeState, variant]);

  React.useEffect(() => {
    if (variant !== 'realtime_screening') return;
    const listeningLevel = localIsSpeaking ? localAudioLevel : localAudioLevel * 0.2;
    const ttsLevel = isSpeaking ? remoteAudioLevel : remoteAudioLevel * 0.15;
    liquidEngineRef.current?.setAudioLevel(listeningLevel);
    liquidEngineRef.current?.setTtsLevel(ttsLevel);
  }, [isSpeaking, localIsSpeaking, remoteAudioLevel, localAudioLevel, variant]);

  React.useEffect(() => {
    if (variant === 'realtime_screening') return;
    const manager = managerRef.current;
    if (!manager) return;

    manager.setState(visualState);
  }, [variant, visualState]);

  React.useEffect(() => {
    if (isSpeaking) {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }
      setVisualState('speaking');
      lastLocalSpeakingRef.current = false;
      return;
    }

    if (localIsSpeaking) {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }
      setVisualState('speaking');
      lastLocalSpeakingRef.current = true;
      return;
    }

    // User just stopped speaking and agent has not started yet -> thinking cue.
    if (lastLocalSpeakingRef.current) {
      setVisualState('thinking');
      lastLocalSpeakingRef.current = false;
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
      }
      thinkingTimeoutRef.current = setTimeout(() => {
        setVisualState('idle');
        thinkingTimeoutRef.current = null;
      }, 5200);
      return;
    }

    if (!thinkingTimeoutRef.current) {
      setVisualState('idle');
    }
  }, [isSpeaking, localIsSpeaking]);

  React.useEffect(() => {
    if (variant === 'realtime_screening') return;
    const manager = managerRef.current;
    if (!manager) return;

    const micPub = participant.getTrackPublication(Track.Source.Microphone);
    const remoteAudio = micPub?.track as RemoteAudioTrack | undefined;
    const localMicPub = localParticipant?.getTrackPublication(Track.Source.Microphone);
    const localAudio = localMicPub?.track as LocalAudioTrack | undefined;

    const remoteSid = remoteAudio?.sid ?? micPub?.trackSid ?? 'none';
    const localSid = localAudio?.sid ?? localMicPub?.trackSid ?? 'none';
    const signature = `${remoteSid}|${localSid}`;
    if (connectionSignatureRef.current === signature) return;

    try {
      remoteSourceRef.current?.disconnect();
      localSourceRef.current?.disconnect();
      mixRef.current?.disconnect();
    } catch {
      // Ignore disconnect errors while swapping tracks.
    }

    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    const mix = context.createGain();
    mix.gain.value = 1;
    mixRef.current = mix;

    if (remoteAudio?.mediaStreamTrack) {
      const remoteStream = new MediaStream([remoteAudio.mediaStreamTrack]);
      const remoteSource = context.createMediaStreamSource(remoteStream);
      remoteSource.connect(mix);
      remoteSourceRef.current = remoteSource;
    } else {
      remoteSourceRef.current = null;
    }

    if (localAudio?.mediaStreamTrack) {
      const localStream = new MediaStream([localAudio.mediaStreamTrack]);
      const localSource = context.createMediaStreamSource(localStream);
      localSource.connect(mix);
      localSourceRef.current = localSource;
    } else {
      localSourceRef.current = null;
    }

    manager.connectAudio(context, mix);
    connectionSignatureRef.current = signature;

    if (context.state !== 'running') {
      context.resume().catch(() => undefined);
    }
  }, [participant, localParticipant, isSpeaking, localIsSpeaking, variant]);

  React.useEffect(() => {
    if (variant !== 'realtime_screening') return;

    if (localIsSpeaking && wasAgentSpeakingRef.current) {
      setInterruptedActive(true);
      if (interruptedTimeoutRef.current) clearTimeout(interruptedTimeoutRef.current);
      interruptedTimeoutRef.current = setTimeout(() => {
        setInterruptedActive(false);
        interruptedTimeoutRef.current = null;
      }, 420);
    }

    if (localIsSpeaking) {
      setProcessingActive(false);
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
    }

    if (wasLocalSpeakingRealtimeRef.current && !localIsSpeaking && !isSpeaking) {
      setProcessingActive(true);
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = setTimeout(() => {
        setProcessingActive(false);
        processingTimeoutRef.current = null;
      }, 5200);
    }

    if (isSpeaking) {
      setProcessingActive(false);
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
    }

    wasAgentSpeakingRef.current = isSpeaking;
    wasLocalSpeakingRealtimeRef.current = localIsSpeaking;

    let next: typeof realtimeState = 'idle';
    if (paused) {
      next = 'paused';
    } else if (interruptedActive) {
      next = 'interrupted';
    } else if (agentTransportMode === 'unknown') {
      next = 'reconnecting';
    } else if (agentAssistantState === 'speaking' || isSpeaking) {
      next = 'speaking';
    } else if (localIsSpeaking) {
      next = 'listening';
    } else if (agentAssistantState === 'thinking' || processingActive) {
      next = 'processing';
    } else if (micUnavailable) {
      next = 'muted_or_no_mic';
    } else {
      next = 'idle';
    }
    setRealtimeState(next);

    return () => undefined;
  }, [agentAssistantState, agentTransportMode, interruptedActive, isSpeaking, localIsSpeaking, micUnavailable, paused, processingActive, variant]);

  if (variant === 'realtime_screening') {
    return (
      <div
        className={`bc-rtx-liquid-orb ${paused ? 'is-paused' : ''}`}
        data-state={realtimeState}
        aria-label="Realtime screening orb"
      >
        <div className="bc-agent-orb-badge">Realtime Screening</div>
        <div className="bc-rtx-liquid-vignette" />
        <div className="bc-rtx-liquid-stage">
          <canvas ref={liquidCanvasRef} className="bc-rtx-liquid-canvas" />
        </div>
        <div className="bc-rtx-liquid-noise" />
      </div>
    );
  }

  return (
    <div
      className={`bc-agent-orb-shell bc-agent-orb-shell--classic ${paused ? 'is-paused' : ''}`}
      aria-label="AI audio visualizer"
    >
      <div ref={containerRef} className="bc-agent-orb-canvas" />
    </div>
  );
}

function BristleconeParticipantTile({
  paused = false,
  agentTransportMode = 'unknown',
  agentAssistantState = 'unknown',
}: {
  paused?: boolean;
  agentTransportMode?: AgentTransportMode;
  agentAssistantState?: AgentAssistantState;
}) {
  const trackRef = useMaybeTrackRefContext();
  const participant = trackRef?.participant;
  const { localParticipant } = useLocalParticipant();

  if (!participant) {
    return <ParticipantTile />;
  }

  const cameraRef = toTrackRef(participant, Track.Source.Camera);
  const micRef = toTrackRef(participant, Track.Source.Microphone);
  const renderOrb =
    isAgentParticipant(participant) || (!participant.isLocal && !cameraRef && Boolean(micRef));
  const orbVariant =
    agentTransportMode === 'realtime_ws' || agentTransportMode === 'direct_client'
      ? 'realtime_screening'
      : getAgentOrbVariant(participant);

  if (!renderOrb) {
    return <ParticipantTile />;
  }

  return (
    <ParticipantTile>
      {cameraRef ? (
        <VideoTrack trackRef={cameraRef} />
      ) : (
        <AgentOrbOverlay
          participant={participant}
          localParticipant={localParticipant}
          variant={orbVariant}
          paused={paused}
          agentTransportMode={agentTransportMode}
          agentAssistantState={agentAssistantState}
        />
      )}
      {micRef ? <AudioTrack trackRef={micRef} /> : null}
      <div className="lk-participant-metadata bc-agent-meta">
        <div className="lk-participant-metadata-item">
          <TrackMutedIndicator
            trackRef={{ participant, source: Track.Source.Microphone }}
            show={'muted'}
          />
          <ParticipantName />
        </div>
        <ConnectionQualityIndicator className="lk-participant-metadata-item" />
      </div>
    </ParticipantTile>
  );
}

function FloatingAgentOrb({
  trackedParticipantIdentities,
  paused = false,
  agentTransportMode = 'unknown',
  agentAssistantState = 'unknown',
  keepVisible = false,
}: {
  trackedParticipantIdentities: Set<string>;
  paused?: boolean;
  agentTransportMode?: AgentTransportMode;
  agentAssistantState?: AgentAssistantState;
  keepVisible?: boolean;
}) {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants({
    updateOnlyOn: [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.ActiveSpeakersChanged,
    ],
  });

  const fallbackAgent = React.useMemo(() => {
    for (const participant of remoteParticipants) {
      if (!isAgentParticipant(participant)) continue;
      const hasCamera = Boolean(toTrackRef(participant, Track.Source.Camera));
      const isTracked = trackedParticipantIdentities.has(participant.identity);
      if (!hasCamera && !isTracked) return participant;
    }
    return undefined;
  }, [remoteParticipants, trackedParticipantIdentities]);

  if (!fallbackAgent) {
    const shouldShowDirectFallback =
      keepVisible || agentTransportMode === 'direct_client' || agentTransportMode === 'realtime_ws';
    if (!shouldShowDirectFallback) return null;

    const syntheticState = paused
      ? 'paused'
      : agentAssistantState === 'speaking'
        ? 'speaking'
        : agentAssistantState === 'thinking'
          ? 'processing'
          : 'idle';

    return (
      <div className="bc-agent-floating-shell" aria-label="AI audio visualizer fallback">
        <div className="bc-rtx-orb" data-state={syntheticState}>
          <div className="bc-agent-orb-badge">Realtime Screening</div>
          <div className="bc-rtx-vignette" />
          <div className="bc-rtx-layer l1" />
          <div className="bc-rtx-layer l2" />
          <div className="bc-rtx-layer l3" />
          <div className="bc-rtx-layer l4" />
          <div className="bc-rtx-aura" />
          <div className="bc-rtx-kernel" />
          <div className="bc-rtx-ring" />
          <div className="bc-rtx-flash" />
          <div className="bc-rtx-mic-indicator" />
          <div className="bc-rtx-noise" />
        </div>
        <div className="bc-agent-floating-label">AI Interview Assistant</div>
      </div>
    );
  }

  return (
    <div className="bc-agent-floating-shell" aria-label="AI audio visualizer fallback">
      <AgentOrbOverlay
        participant={fallbackAgent}
        localParticipant={localParticipant}
        variant={
          agentTransportMode === 'realtime_ws' || agentTransportMode === 'direct_client'
            ? 'realtime_screening'
            : getAgentOrbVariant(fallbackAgent)
        }
        paused={paused}
        agentTransportMode={agentTransportMode}
        agentAssistantState={agentAssistantState}
      />
      <div className="bc-agent-floating-label">
        {fallbackAgent.name || fallbackAgent.identity}
      </div>
    </div>
  );
}

export function BristleconeVideoConference({
  chatMessageFormatter,
  SettingsComponent,
  isModerator = false,
  ...props
}: BristleconeVideoConferenceProps) {
  const [showChat, setShowChat] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    {
      updateOnlyOn: [
        RoomEvent.ActiveSpeakersChanged,
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
      ],
      onlySubscribed: false,
    },
  );
  const trackedParticipantIdentities = React.useMemo(() => {
    const ids = new Set<string>();
    for (const track of tracks) {
      const id = track?.participant?.identity;
      if (id) ids.add(id);
    }
    return ids;
  }, [tracks]);
  const room = useRoomContext();
  const [isInterviewPaused, setIsInterviewPaused] = React.useState(false);
  const [agentTransportMode, setAgentTransportMode] = React.useState<AgentTransportMode>('unknown');
  const [agentAssistantState, setAgentAssistantState] = React.useState<AgentAssistantState>('unknown');
  const [agentFullDuplex, setAgentFullDuplex] = React.useState(false);
  const [agentMediaModeEffective, setAgentMediaModeEffective] = React.useState<AgentMediaMode>('unknown');
  const [agentMediaModeConfigured, setAgentMediaModeConfigured] = React.useState<AgentMediaMode>('unknown');
  const [stickyRealtimeUi, setStickyRealtimeUi] = React.useState(false);
  const [roomDebugEnabled, setRoomDebugEnabled] = React.useState(false);

  React.useEffect(() => {
    const enabled = isRoomDebugEnabled();
    setRoomDebugEnabled(enabled);
    if (enabled) {
      roomDebugLog(true, 'debug-enabled', { room: room.name || '(unknown)' });
    }
  }, [room.name]);

  React.useEffect(() => {
    const onDataReceived = (payload: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(payload).trim();
        if (!text.startsWith('{')) return;
        const parsed = JSON.parse(text);
        roomDebugLog(roomDebugEnabled, 'data-received', {
          type: parsed?.type || 'unknown',
          transportMode: parsed?.transportMode || undefined,
          mediaModeEffective: parsed?.mediaModeEffective || undefined,
          assistantState: parsed?.assistantState || undefined,
          paused: parsed?.paused,
        });
        if (parsed?.type === 'agent_control_state') {
          setIsInterviewPaused(Boolean(parsed?.paused));
          const mode = String(parsed?.transportMode || '').trim();
          setAgentTransportMode(
            mode === 'realtime_ws'
              ? 'realtime_ws'
              : mode === 'direct_client'
                ? 'direct_client'
                : mode === 'turn_based'
                  ? 'turn_based'
                  : 'unknown',
          );
          setAgentFullDuplex(Boolean(parsed?.fullDuplex));
          const assistantStateRaw = String(parsed?.assistantState || '').trim().toLowerCase();
          setAgentAssistantState(
            assistantStateRaw === 'speaking'
              ? 'speaking'
              : assistantStateRaw === 'thinking'
                ? 'thinking'
                : assistantStateRaw === 'idle'
                  ? 'idle'
                  : 'unknown',
          );
          const mediaModeEffective = String(parsed?.mediaModeEffective || '').trim();
          setAgentMediaModeEffective(
            mediaModeEffective === 'direct' ? 'direct' : mediaModeEffective === 'relay' ? 'relay' : 'unknown',
          );
          const mediaModeConfigured = String(parsed?.mediaModeConfigured || '').trim();
          setAgentMediaModeConfigured(
            mediaModeConfigured === 'direct' ? 'direct' : mediaModeConfigured === 'relay' ? 'relay' : 'unknown',
          );
        }
      } catch {
        // Ignore non-JSON control payloads.
      }
    };
    room.on(RoomEvent.DataReceived, onDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, onDataReceived);
    };
  }, [room, roomDebugEnabled]);

  React.useEffect(() => {
    const onConnected = () => roomDebugLog(roomDebugEnabled, 'room-connected', { room: room.name });
    const onReconnecting = () => roomDebugLog(roomDebugEnabled, 'room-reconnecting');
    const onReconnected = () => roomDebugLog(roomDebugEnabled, 'room-reconnected');
    const onDisconnected = () => roomDebugLog(roomDebugEnabled, 'room-disconnected');
    const onParticipantConnected = (participant: Participant) =>
      roomDebugLog(roomDebugEnabled, 'participant-connected', {
        identity: participant.identity,
        name: participant.name || '',
        kind: participant.kind || '',
        isAgentLike: isAgentParticipant(participant),
      });
    const onParticipantDisconnected = (participant: Participant) =>
      roomDebugLog(roomDebugEnabled, 'participant-disconnected', {
        identity: participant.identity,
        name: participant.name || '',
        kind: participant.kind || '',
        isAgentLike: isAgentParticipant(participant),
      });
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    };
  }, [room, roomDebugEnabled]);

  React.useEffect(() => {
    if (agentTransportMode === 'direct_client' || agentTransportMode === 'realtime_ws') {
      setStickyRealtimeUi(true);
    }
  }, [agentTransportMode]);

  const trackSnapshot = React.useMemo(
    () =>
      tracks.map((track) => ({
        participant: track?.participant?.identity || '',
        source: String(track?.source || ''),
        placeholder: !isTrackReference(track),
        isAgentLike: isAgentParticipant(track?.participant),
      })),
    [tracks],
  );

  React.useEffect(() => {
    roomDebugLog(roomDebugEnabled, 'state-snapshot', {
      trackCount: trackSnapshot.length,
      trackSnapshot,
      trackedParticipantCount: trackedParticipantIdentities.size,
      stickyRealtimeUi,
      isInterviewPaused,
      agentTransportMode,
      agentMediaModeEffective,
      agentAssistantState,
    });
  }, [
    roomDebugEnabled,
    trackSnapshot,
    trackedParticipantIdentities,
    stickyRealtimeUi,
    isInterviewPaused,
    agentTransportMode,
    agentMediaModeEffective,
    agentAssistantState,
  ]);

  const togglePause = React.useCallback(async () => {
    if (!isModerator) return;
    const pausedNext = !isInterviewPaused;
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'agent_control', action: pausedNext ? 'pause' : 'resume' }),
    );
    await room.localParticipant.publishData(payload, { reliable: true });

    const endpoint = pausedNext ? 'stop' : 'start';
    await fetch(`${RECORDING_ENDPOINT}/${endpoint}?roomName=${encodeURIComponent(room.name)}`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => undefined);
    setIsInterviewPaused(pausedNext);
  }, [isInterviewPaused, isModerator, room]);

  const layoutContext = useCreateLayoutContext();
  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((track) => !sameTrackRef(track, focusTrack));
  const transportLabel =
    agentTransportMode === 'realtime_ws'
      ? `Agent Transport: Realtime WS (${agentFullDuplex ? 'Full Duplex' : 'Realtime'})`
      : agentTransportMode === 'direct_client'
        ? 'Agent Transport: Direct Client (Full Duplex)'
      : agentTransportMode === 'turn_based'
        ? 'Agent Transport: Turn-based (Half Duplex)'
        : 'Agent Transport: Detecting...';
  const mediaLabel =
    agentMediaModeEffective === 'direct'
      ? 'Media Path: Direct'
      : agentMediaModeEffective === 'relay'
        ? 'Media Path: Relay'
        : 'Media Path: Detecting...';
  const mediaDetailLabel =
    agentMediaModeConfigured !== 'unknown' && agentMediaModeConfigured !== agentMediaModeEffective
      ? ` (configured: ${agentMediaModeConfigured})`
      : '';

  return (
    <div className="lk-video-conference" {...props}>
      <LayoutContextProvider
        value={layoutContext}
        onWidgetChange={(state) => {
          setShowChat(!!state.showChat);
          setShowSettings(!!state.showSettings);
        }}
      >
        <div className="lk-video-conference-inner">
          <div
            style={{
              alignSelf: 'center',
              marginBottom: '0.5rem',
              padding: '0.3rem 0.7rem',
              borderRadius: '999px',
              border: '1px solid rgba(120, 120, 120, 0.45)',
              background:
                agentTransportMode === 'realtime_ws' || agentTransportMode === 'direct_client'
                  ? 'rgba(16, 185, 129, 0.15)'
                  : agentTransportMode === 'turn_based'
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'rgba(100, 116, 139, 0.15)',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            {transportLabel}
          </div>
          <div
            style={{
              alignSelf: 'center',
              marginBottom: '0.5rem',
              padding: '0.3rem 0.7rem',
              borderRadius: '999px',
              border: '1px solid rgba(120, 120, 120, 0.45)',
              background:
                agentMediaModeEffective === 'direct'
                  ? 'rgba(16, 185, 129, 0.15)'
                  : agentMediaModeEffective === 'relay'
                    ? 'rgba(59, 130, 246, 0.15)'
                    : 'rgba(100, 116, 139, 0.15)',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            {`${mediaLabel}${mediaDetailLabel}`}
          </div>
          {!focusTrack ? (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}>
                  <BristleconeParticipantTile
                    paused={isInterviewPaused}
                    agentTransportMode={agentTransportMode}
                    agentAssistantState={agentAssistantState}
                  />
                </GridLayout>
              </div>
          ) : (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <CarouselLayout tracks={carouselTracks}>
                  <BristleconeParticipantTile
                    paused={isInterviewPaused}
                    agentTransportMode={agentTransportMode}
                    agentAssistantState={agentAssistantState}
                  />
                </CarouselLayout>
                <FocusLayout trackRef={focusTrack} />
              </FocusLayoutContainer>
            </div>
          )}
          <ControlBarRecordingExtras
            showSettings={!!SettingsComponent}
            isModerator={isModerator}
            isInterviewPaused={isInterviewPaused}
            onTogglePause={togglePause}
          />
          <FloatingAgentOrb
            trackedParticipantIdentities={trackedParticipantIdentities}
            paused={isInterviewPaused}
            agentTransportMode={agentTransportMode}
            agentAssistantState={agentAssistantState}
            keepVisible={stickyRealtimeUi}
          />
        </div>

        <Chat style={{ display: showChat ? 'grid' : 'none' }} messageFormatter={chatMessageFormatter} />

        {SettingsComponent ? (
          <div className="lk-settings-menu-modal" style={{ display: showSettings ? 'block' : 'none' }}>
            <SettingsComponent />
          </div>
        ) : null}
      </LayoutContextProvider>

      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
