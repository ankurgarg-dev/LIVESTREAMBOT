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
  isTrackReference,
  useCreateLayoutContext,
  useIsSpeaking,
  useIsRecording,
  useLocalParticipant,
  useMaybeTrackRefContext,
  useRoomContext,
  useTracks,
  type MessageFormatter,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { RoomEvent, Track, type LocalAudioTrack, type Participant, type RemoteAudioTrack } from 'livekit-client';
import { VisualizerManager } from '@/components/visualizer/VisualizerManager';
import { OrbVisualizer } from '@/components/visualizer/OrbVisualizer';
import { WaveformVisualizer } from '@/components/visualizer/WaveformVisualizer';
import { ParticleHaloVisualizer } from '@/components/visualizer/ParticleHaloVisualizer';
import { EqualizerVisualizer } from '@/components/visualizer/EqualizerVisualizer';
import type { VisualizerState } from '@/components/visualizer/VoiceVisualizer';
import { Orb, type AgentState as OrbAgentState } from '@/components/ui/orb';
const RECORDING_ENDPOINT = process.env.NEXT_PUBLIC_LK_RECORD_ENDPOINT ?? '/api/record';

export interface BristleconeVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  SettingsComponent?: React.ComponentType;
  isModerator?: boolean;
  expectedAgentType?: 'classic' | 'realtime_screening';
}

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
    if (!room.name) return;
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
  paused = false,
  variant = 'classic',
  directAgentVisualState = 'idle',
}: {
  participant: Participant;
  localParticipant?: Participant;
  paused?: boolean;
  variant?: 'classic' | 'realtime_screening';
  directAgentVisualState?: 'idle' | 'speaking';
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const managerRef = React.useRef<VisualizerManager | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const mixRef = React.useRef<GainNode | null>(null);
  const remoteSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const localSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const connectionSignatureRef = React.useRef<string | null>(null);
  const lastLocalSpeakingRef = React.useRef(false);
  const thinkingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visualState, setVisualState] = React.useState<VisualizerState>('idle');
  const [agentActiveSpeaker, setAgentActiveSpeaker] = React.useState(false);
  const [localActiveSpeaker, setLocalActiveSpeaker] = React.useState(false);
  const room = useRoomContext();

  const isSpeaking = useIsSpeaking(participant);
  const localIsSpeaking = useIsSpeaking(localParticipant);

  React.useEffect(() => {
    const updateActiveSpeakers = () => {
      const active = room.activeSpeakers;
      const localIdentity = localParticipant?.identity;
      const agentSpeaking = active.some((p) => p.identity === participant.identity);
      const localSpeaking = localIdentity ? active.some((p) => p.identity === localIdentity) : false;
      setAgentActiveSpeaker(agentSpeaking);
      setLocalActiveSpeaker(localSpeaking);
    };

    updateActiveSpeakers();
    room.on(RoomEvent.ActiveSpeakersChanged, updateActiveSpeakers);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, updateActiveSpeakers);
    };
  }, [room, participant.identity, localParticipant]);

  React.useEffect(() => {
    if (variant === 'realtime_screening') return;
    if (!containerRef.current) return;

    const manager = new VisualizerManager(containerRef.current);
    manager.register('orb', OrbVisualizer);
    manager.register('waveform', WaveformVisualizer);
    manager.register('particle-halo', ParticleHaloVisualizer);
    manager.register('equalizer', EqualizerVisualizer);
    manager.switch('orb');
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
    if (variant === 'realtime_screening') return;
    const manager = managerRef.current;
    if (!manager) return;

    manager.setState(visualState);
  }, [variant, visualState]);

  React.useEffect(() => {
    const agentSpeakingNow =
      variant === 'realtime_screening'
        ? directAgentVisualState === 'speaking'
        : isSpeaking || agentActiveSpeaker;
    const localSpeakingNow = localIsSpeaking || localActiveSpeaker;

    if (agentSpeakingNow) {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }
      setVisualState('speaking');
      lastLocalSpeakingRef.current = false;
      return;
    }

    if (localSpeakingNow) {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }
      setVisualState('listening');
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
  }, [variant, directAgentVisualState, isSpeaking, localIsSpeaking, agentActiveSpeaker, localActiveSpeaker]);

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
  }, [variant, participant, localParticipant, isSpeaking, localIsSpeaking]);

  const realtimeOrbState: OrbAgentState =
    visualState === 'speaking'
      ? 'talking'
      : visualState === 'listening'
        ? 'listening'
        : visualState === 'thinking'
          ? 'thinking'
          : null;

  return (
    <div
      className={`bc-agent-orb-shell ${
        variant === 'realtime_screening' ? 'bc-agent-orb-shell--realtime' : 'bc-agent-orb-shell--classic'
      } bc-agent-orb-shell--state-${visualState} ${paused ? 'is-paused' : ''}`}
      aria-label="AI audio visualizer"
      data-agent-state={visualState}
    >
      {variant === 'realtime_screening' ? (
        <div className="bc-agent-realtime-cluster">
          <div className="bc-agent-storm bc-agent-storm--a" aria-hidden="true" />
          <div className="bc-agent-storm bc-agent-storm--b" aria-hidden="true" />
          <div className="bc-agent-particle-ring" aria-hidden="true" />
          <div className="bc-agent-orb-core">
            <div className="bc-agent-orb-realtime-wrap">
              <div className="bc-agent-orb-realtime-outer">
                <div className="bc-agent-orb-realtime-inner">
                  <Orb colors={['#21A6BD', '#4BC984']} seed={1100} agentState={realtimeOrbState} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bc-agent-orb-core">
          <div ref={containerRef} className="bc-agent-orb-canvas" />
        </div>
      )}
    </div>
  );
}

function BristleconeParticipantTile({
  paused = false,
  expectedAgentType = 'classic',
  agentIdentityHint,
  directAgentVisualState = 'idle',
}: {
  paused?: boolean;
  expectedAgentType?: 'classic' | 'realtime_screening';
  agentIdentityHint?: string;
  directAgentVisualState?: 'idle' | 'speaking';
}) {
  const trackRef = useMaybeTrackRefContext();
  const participant = trackRef?.participant;
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  if (!participant) {
    return <ParticipantTile />;
  }
  const participantPresent =
    participant.isLocal || room.localParticipant.identity === participant.identity || room.remoteParticipants.has(participant.identity);
  if (!participantPresent) {
    // Track refs can briefly outlive participant presence during reconnect churn.
    // Skip derived track widgets for stale participants to avoid LiveKit internal add-track errors.
    return <ParticipantTile />;
  }

  const micRef = toTrackRef(participant, Track.Source.Microphone);
  const hintedAsAgent = Boolean(agentIdentityHint && participant.identity === agentIdentityHint);
  const realtimeRemoteFallback =
    expectedAgentType === 'realtime_screening' && !participant.isLocal;
  const renderOrb =
    isAgentParticipant(participant) ||
    hintedAsAgent ||
    realtimeRemoteFallback ||
    !participant.isLocal;

  if (!renderOrb) {
    return <ParticipantTile />;
  }

  return (
    <div className="lk-participant-tile bc-agent-participant-tile">
      <AgentOrbOverlay
        participant={participant}
        localParticipant={localParticipant}
        paused={paused}
        variant={expectedAgentType}
        directAgentVisualState={directAgentVisualState}
      />
      {micRef ? <AudioTrack trackRef={micRef} /> : null}
      <div className="lk-participant-metadata bc-agent-meta">
        <div className="lk-participant-metadata-item">
          {micRef ? <TrackMutedIndicator trackRef={micRef} show={'muted'} /> : null}
          <ParticipantName />
        </div>
        <ConnectionQualityIndicator className="lk-participant-metadata-item" />
      </div>
    </div>
  );
}

export function BristleconeVideoConference({
  chatMessageFormatter,
  SettingsComponent,
  isModerator = false,
  expectedAgentType = 'classic',
  ...props
}: BristleconeVideoConferenceProps) {
  const [showChat, setShowChat] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const room = useRoomContext();

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.Microphone, withPlaceholder: false },
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
  const layoutTracks = React.useMemo(() => {
    const sourcePriority = (source: Track.Source | string): number => {
      if (source === Track.Source.Camera) return 4;
      if (source === Track.Source.Microphone) return 3;
      if (source === Track.Source.ScreenShare) return 2;
      return 1;
    };

    const byParticipant = new Map<string, TrackReferenceOrPlaceholder>();
    for (const track of tracks) {
      const participant = track?.participant;
      const participantId = String(participant?.identity || '').trim();
      const participantPresent =
        Boolean(participant?.isLocal) ||
        participantId === room.localParticipant.identity ||
        room.remoteParticipants.has(participantId);
      if (!participantPresent) continue;

      const existing = byParticipant.get(participantId);
      if (!existing) {
        byParticipant.set(participantId, track);
        continue;
      }

      const existingSource = existing?.source ?? '';
      const nextSource = track?.source ?? '';
      const existingPriority = sourcePriority(existingSource);
      const nextPriority = sourcePriority(nextSource);

      if (nextPriority > existingPriority) {
        byParticipant.set(participantId, track);
        continue;
      }
      if (nextPriority === existingPriority && !isTrackReference(existing) && isTrackReference(track)) {
        byParticipant.set(participantId, track);
      }
    }
    return Array.from(byParticipant.values());
  }, [room.localParticipant.identity, room.remoteParticipants, tracks]);
  const layoutTrackKey = React.useMemo(
    () =>
      layoutTracks
        .map((track) => {
          const participantId = String(track?.participant?.identity || '').trim();
          const sourceId = String(track?.source || '').trim();
          const trackId =
            isTrackReference(track) && track.publication?.trackSid
              ? String(track.publication.trackSid)
              : 'placeholder';
          return `${participantId}:${sourceId}:${trackId}`;
        })
        .sort()
        .join('|'),
    [layoutTracks],
  );
  const [isInterviewPaused, setIsInterviewPaused] = React.useState(false);
  const [roomDebugEnabled, setRoomDebugEnabled] = React.useState(false);
  const [agentIdentityHint, setAgentIdentityHint] = React.useState<string | undefined>(undefined);
  const [directAgentVisualState, setDirectAgentVisualState] = React.useState<'idle' | 'speaking'>('idle');
  const [audioPlayable, setAudioPlayable] = React.useState<boolean>(room.canPlaybackAudio);
  const [audioActionMessage, setAudioActionMessage] = React.useState<string>('idle');
  const [botAudioStatus, setBotAudioStatus] = React.useState<string>('bot audio: unknown');

  React.useEffect(() => {
    const enabled = isRoomDebugEnabled();
    setRoomDebugEnabled(enabled);
    if (enabled) {
      roomDebugLog(true, 'debug-enabled', { room: room.name || '(unknown)' });
    }
  }, [room.name]);

  React.useEffect(() => {
    const onDataReceived = (payload: Uint8Array, participant?: Participant) => {
      try {
        const text = new TextDecoder().decode(payload).trim();
        if (!text.startsWith('{')) return;
        const parsed = JSON.parse(text);
        roomDebugLog(roomDebugEnabled, 'data-received', {
          type: parsed?.type || 'unknown',
          paused: parsed?.paused,
        });
        if (parsed?.type === 'agent_control_state') {
          setIsInterviewPaused(Boolean(parsed?.paused));
          if (participant?.identity) {
            setAgentIdentityHint(participant.identity);
          }
          return;
        }
        if (parsed?.type === 'direct_agent_state') {
          const nextState = String(parsed?.state || '').trim().toLowerCase();
          setDirectAgentVisualState(nextState === 'speaking' ? 'speaking' : 'idle');
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
    setAudioPlayable(room.canPlaybackAudio);
    const onAudioPlaybackChanged = () => {
      setAudioPlayable(room.canPlaybackAudio);
      roomDebugLog(roomDebugEnabled, 'audio-playback-changed', { canPlaybackAudio: room.canPlaybackAudio });
    };
    room.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
    };
  }, [room, roomDebugEnabled]);

  const forceStartAudio = React.useCallback(async () => {
    const playLocalProbeTone = async () => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        if (ctx.state !== 'running') {
          await ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.04;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
        setTimeout(() => {
          void ctx.close().catch(() => undefined);
        }, 250);
      } catch {
        // Ignore local probe tone failures.
      }
    };

    try {
      setAudioActionMessage('starting...');
      await room.startAudio();
      setAudioPlayable(room.canPlaybackAudio);
      await playLocalProbeTone();
      setAudioActionMessage(`started @ ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      const reason = String((error as any)?.message || error || 'unknown');
      roomDebugLog(true, 'audio-start-failed', { error: reason });
      setAudioActionMessage(`failed: ${reason}`);
    }
  }, [room]);

  const syncBotAudioSubscription = React.useCallback(() => {
    let status = 'bot audio: agent not found';
    for (const participant of room.remoteParticipants.values()) {
      if (!isAgentParticipant(participant)) continue;
      const pub = participant.getTrackPublication(Track.Source.Microphone);
      if (!pub) {
        status = `bot audio: ${participant.identity} mic missing`;
        continue;
      }
      if (!pub.isSubscribed) {
        // Force subscription in case LiveKit autosubscribe drifted.
        void pub.setSubscribed(true);
      }
      const muted = pub.isMuted ? 'muted' : 'unmuted';
      const sub = pub.isSubscribed ? 'subscribed' : 'unsubscribed';
      const hasTrack = pub.track ? 'track:yes' : 'track:no';
      status = `bot audio: ${participant.identity} ${sub} ${muted} ${hasTrack}`;
      break;
    }
    setBotAudioStatus(status);
  }, [room]);

  React.useEffect(() => {
    syncBotAudioSubscription();
    const refresh = () => syncBotAudioSubscription();
    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
    room.on(RoomEvent.TrackPublished, refresh);
    room.on(RoomEvent.TrackUnpublished, refresh);
    room.on(RoomEvent.TrackSubscribed, refresh);
    room.on(RoomEvent.TrackUnsubscribed, refresh);
    room.on(RoomEvent.TrackMuted, refresh);
    room.on(RoomEvent.TrackUnmuted, refresh);
    const timer = setInterval(refresh, 1500);
    return () => {
      clearInterval(timer);
      room.off(RoomEvent.ParticipantConnected, refresh);
      room.off(RoomEvent.ParticipantDisconnected, refresh);
      room.off(RoomEvent.TrackPublished, refresh);
      room.off(RoomEvent.TrackUnpublished, refresh);
      room.off(RoomEvent.TrackSubscribed, refresh);
      room.off(RoomEvent.TrackUnsubscribed, refresh);
      room.off(RoomEvent.TrackMuted, refresh);
      room.off(RoomEvent.TrackUnmuted, refresh);
    };
  }, [room, syncBotAudioSubscription]);

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

  const trackSnapshot = React.useMemo(
    () =>
      layoutTracks.map((track) => ({
        participant: track?.participant?.identity || '',
        source: String(track?.source || ''),
        placeholder: !isTrackReference(track),
        isAgentLike: isAgentParticipant(track?.participant),
      })),
    [layoutTracks],
  );

  React.useEffect(() => {
    roomDebugLog(roomDebugEnabled, 'state-snapshot', {
      trackCount: trackSnapshot.length,
      trackSnapshot,
      isInterviewPaused,
    });
  }, [roomDebugEnabled, trackSnapshot, isInterviewPaused]);

  const togglePause = React.useCallback(async () => {
    if (!isModerator) return;
    if (!room.name) return;
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
  const focusTrack = undefined;
  const carouselTracks = layoutTracks.filter((track) => !sameTrackRef(track, focusTrack));

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
          {!focusTrack ? (
            <div className="lk-grid-layout-wrapper">
              <GridLayout key={layoutTrackKey} tracks={layoutTracks}>
                  <BristleconeParticipantTile
                    paused={isInterviewPaused}
                    expectedAgentType={expectedAgentType}
                    agentIdentityHint={agentIdentityHint}
                    directAgentVisualState={directAgentVisualState}
                  />
                </GridLayout>
              </div>
          ) : (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <CarouselLayout tracks={carouselTracks}>
                  <BristleconeParticipantTile
                    paused={isInterviewPaused}
                    expectedAgentType={expectedAgentType}
                    agentIdentityHint={agentIdentityHint}
                    directAgentVisualState={directAgentVisualState}
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
        </div>

        <Chat style={{ display: showChat ? 'grid' : 'none' }} messageFormatter={chatMessageFormatter} />

        {SettingsComponent ? (
          <div className="lk-settings-menu-modal" style={{ display: showSettings ? 'block' : 'none' }}>
            <SettingsComponent />
          </div>
        ) : null}
      </LayoutContextProvider>

      <RoomAudioRenderer />
      <button
        className="lk-button"
        type="button"
        onClick={forceStartAudio}
        style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 1000 }}
      >
        Start Bot Audio
      </button>
      <div
        style={{
          position: 'fixed',
          bottom: 12,
          right: 170,
          zIndex: 1000,
          padding: '6px 10px',
          borderRadius: 10,
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontSize: 12,
        }}
      >
        {audioPlayable ? 'Audio: allowed' : 'Audio: blocked'} | {audioActionMessage}
      </div>
      <div
        style={{
          position: 'fixed',
          bottom: 42,
          right: 170,
          zIndex: 1000,
          padding: '6px 10px',
          borderRadius: 10,
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontSize: 12,
          maxWidth: 560,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={botAudioStatus}
      >
        {botAudioStatus}
      </div>
      <ConnectionStateToast />
    </div>
  );
}
