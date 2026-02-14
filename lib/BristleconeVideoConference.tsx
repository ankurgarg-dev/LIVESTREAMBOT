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
  useLocalParticipant,
  useMaybeTrackRefContext,
  usePinnedTracks,
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

export interface BristleconeVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  SettingsComponent?: React.ComponentType;
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
}: {
  participant: Participant;
  localParticipant?: Participant;
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

  const isSpeaking = useIsSpeaking(participant);
  const localIsSpeaking = useIsSpeaking(localParticipant);

  React.useEffect(() => {
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
  }, []);

  React.useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    manager.setState(visualState);
  }, [visualState]);

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
  }, [participant, localParticipant, isSpeaking, localIsSpeaking]);

  return (
    <div className="bc-agent-orb-shell" aria-label="AI audio visualizer">
      <div ref={containerRef} className="bc-agent-orb-canvas" />
    </div>
  );
}

function BristleconeParticipantTile() {
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

  if (!renderOrb) {
    return <ParticipantTile />;
  }

  return (
    <ParticipantTile>
      {cameraRef ? (
        <VideoTrack trackRef={cameraRef} />
      ) : (
        <AgentOrbOverlay participant={participant} localParticipant={localParticipant} />
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

export function BristleconeVideoConference({
  chatMessageFormatter,
  SettingsComponent,
  ...props
}: BristleconeVideoConferenceProps) {
  const [showChat, setShowChat] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const layoutContext = useCreateLayoutContext();
  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((track) => !sameTrackRef(track, focusTrack));

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
              <GridLayout tracks={tracks}>
                <BristleconeParticipantTile />
              </GridLayout>
            </div>
          ) : (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <CarouselLayout tracks={carouselTracks}>
                  <BristleconeParticipantTile />
                </CarouselLayout>
                <FocusLayout trackRef={focusTrack} />
              </FocusLayoutContainer>
            </div>
          )}
          <ControlBar controls={{ chat: true, settings: !!SettingsComponent }} />
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
