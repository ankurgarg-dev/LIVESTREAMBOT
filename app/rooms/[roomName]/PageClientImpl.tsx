'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  useIsRecording,
} from '@livekit/components-react';
import {
  ConnectionState,
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  TrackPublishDefaults,
  VideoCaptureOptions,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import { BristleconeVideoConference } from '@/lib/BristleconeVideoConference';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU !== 'false';
const RECORDING_ENDPOINT = process.env.NEXT_PUBLIC_LK_RECORD_ENDPOINT ?? '/api/record';
const AUTO_RECORD_INTERVIEW = process.env.NEXT_PUBLIC_AUTO_RECORD_INTERVIEW === 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  autoJoin?: boolean;
  participantName?: string;
  agentType?: 'classic' | 'realtime_screening';
}) {
  const router = useRouter();
  const [roomDraft, setRoomDraft] = React.useState(props.roomName);
  const [autoJoinDisabled, setAutoJoinDisabled] = React.useState(false);
  const [autoJoinError, setAutoJoinError] = React.useState('');
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const fetchConnectionDetails = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    if (props.agentType === 'realtime_screening') {
      url.searchParams.append('agentType', props.agentType);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    if (!connectionDetailsResp.ok) {
      throw new Error(connectionDetailsData?.error || connectionDetailsData?.message || 'Failed to join room');
    }
    setConnectionDetails(connectionDetailsData);
  }, [props.agentType, props.region, props.roomName]);
  const handlePreJoinSubmit = React.useCallback(
    async (values: LocalUserChoices) => {
      setAutoJoinError('');
      await fetchConnectionDetails(values);
    },
    [fetchConnectionDetails],
  );
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);
  const handleSwitchRoom = React.useCallback(() => {
    const target = roomDraft.trim();
    if (!target) return;
    if (target === props.roomName) return;
    router.push(`/rooms/${encodeURIComponent(target)}`);
  }, [roomDraft, props.roomName, router]);

  React.useEffect(() => {
    if (!props.autoJoin || autoJoinDisabled || preJoinChoices || connectionDetails) return;
    const fallbackName = props.participantName?.trim() || 'Moderator';
    fetchConnectionDetails({
      username: fallbackName,
      audioEnabled: true,
      videoEnabled: true,
      audioDeviceId: '',
      videoDeviceId: '',
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Could not auto join room';
      setAutoJoinError(message);
      setAutoJoinDisabled(true);
    });
  }, [
    autoJoinDisabled,
    connectionDetails,
    fetchConnectionDetails,
    preJoinChoices,
    props.autoJoin,
    props.participantName,
  ]);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <div style={{ width: '100%', maxWidth: '560px', paddingInline: '1rem' }}>
            {props.autoJoin && !autoJoinDisabled ? (
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                <h3 style={{ margin: 0 }}>Joining room...</h3>
                <p style={{ margin: 0 }}>
                  Connecting to <strong>{props.roomName}</strong> as{' '}
                  <strong>{props.participantName?.trim() || 'Moderator'}</strong>.
                </p>
                {autoJoinError ? <p style={{ margin: 0, color: '#b33a3a' }}>{autoJoinError}</p> : null}
                <button className="lk-button" onClick={() => setAutoJoinDisabled(true)}>
                  Open Ready Page Instead
                </button>
                <button className="lk-button" onClick={() => router.push('/')}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto',
                    gap: '0.5rem',
                    marginBottom: '0.6rem',
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="text"
                    value={roomDraft}
                    onChange={(e) => setRoomDraft(e.target.value)}
                    placeholder="Room name"
                    aria-label="Room name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSwitchRoom();
                      }
                    }}
                  />
                  <button className="lk-button" onClick={handleSwitchRoom}>
                    Switch Room
                  </button>
                  <button className="lk-button" onClick={() => router.push('/')}>
                    Cancel
                  </button>
                </div>
                <PreJoin
                  defaults={preJoinDefaults}
                  onSubmit={handlePreJoinSubmit}
                  onError={handlePreJoinError}
                />
              </>
            )}
          </div>
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{ codec: props.codec, hq: props.hq }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h720,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
      },
      adaptiveStream: true,
      dynacast: true,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: true,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  const startRecordingBestEffort = React.useCallback(async () => {
    if (room.isE2EEEnabled) return;
    try {
      const response = await fetch(
        `${RECORDING_ENDPOINT}/start?roomName=${encodeURIComponent(room.name)}`,
        { method: 'POST' },
      );
      if (!response.ok && response.status !== 409) {
        const details = await response.text().catch(() => response.statusText);
        console.error('[recording] start failed:', response.status, details);
      }
    } catch (error) {
      console.error('[recording] start failed:', error);
    }
  }, [room]);

  const stopRecordingBestEffort = React.useCallback(
    async (useBeacon = false) => {
      if (room.isE2EEEnabled) return;
      const stopUrl = `${RECORDING_ENDPOINT}/stop?roomName=${encodeURIComponent(room.name)}`;
      if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try {
          const blob = new Blob([], { type: 'application/json' });
          navigator.sendBeacon(stopUrl, blob);
          return;
        } catch {
          // fallback to keepalive fetch below
        }
      }
      try {
        const response = await fetch(stopUrl, { method: 'POST', keepalive: true });
        if (!response.ok && response.status !== 404) {
          const details = await response.text().catch(() => response.statusText);
          console.error('[recording] stop failed:', response.status, details);
        }
      } catch (error) {
        console.error('[recording] stop failed:', error);
      }
    },
    [room],
  );

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .catch((error) => {
          handleError(error);
        });
      if (props.userChoices.videoEnabled) {
        room.localParticipant.setCameraEnabled(true).catch((error) => {
          handleError(error);
        });
      }
      if (props.userChoices.audioEnabled) {
        room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
          handleError(error);
        });
      }
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (!AUTO_RECORD_INTERVIEW) return;
    let hasRequestedStart = false;

    const handleConnected = () => {
      if (hasRequestedStart) return;
      hasRequestedStart = true;
      startRecordingBestEffort().catch((error) =>
        console.error('[recording] auto-start error:', error),
      );
    };

    room.on(RoomEvent.Connected, handleConnected);
    if (room.state === ConnectionState.Connected) {
      handleConnected();
    }

    return () => {
      room.off(RoomEvent.Connected, handleConnected);
    };
  }, [room, startRecordingBestEffort]);

  React.useEffect(() => {
    const handleDisconnected = () => {
      stopRecordingBestEffort(true).catch((error) =>
        console.error('[recording] auto-stop on disconnect error:', error),
      );
    };

    const handlePageHide = () => {
      stopRecordingBestEffort(true).catch((error) =>
        console.error('[recording] auto-stop on pagehide error:', error),
      );
    };

    room.on(RoomEvent.Disconnected, handleDisconnected);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      stopRecordingBestEffort(true).catch(() => undefined);
    };
  }, [room, stopRecordingBestEffort]);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <InRoomStatusHud room={room} />
        <KeyboardShortcuts />
        <BristleconeVideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
        />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}

function InRoomStatusHud(props: { room: Room }) {
  const isRecording = useIsRecording();
  const [localSpeaking, setLocalSpeaking] = React.useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = React.useState(false);
  const [assistantThinking, setAssistantThinking] = React.useState(false);

  const hasRecentUserSpeechRef = React.useRef(false);
  const wasLocalSpeakingRef = React.useRef(false);
  const thinkTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const clearThinkTimeout = () => {
      if (!thinkTimeoutRef.current) return;
      clearTimeout(thinkTimeoutRef.current);
      thinkTimeoutRef.current = null;
    };

    const onActiveSpeakersChanged = (speakers: Array<{ identity: string }>) => {
      const localIdentity = props.room.localParticipant.identity;
      const localIsNowSpeaking = speakers.some((p) => p.identity === localIdentity);
      const botIsNowSpeaking = speakers.some((p) => {
        const id = p.identity.toLowerCase();
        return id.includes('agent') || id.includes('assistant') || id.includes('ai');
      });

      setLocalSpeaking(localIsNowSpeaking);
      setAssistantSpeaking(botIsNowSpeaking);

      if (localIsNowSpeaking) {
        hasRecentUserSpeechRef.current = true;
        clearThinkTimeout();
        setAssistantThinking(false);
      }

      if (wasLocalSpeakingRef.current && !localIsNowSpeaking) {
        if (!botIsNowSpeaking && hasRecentUserSpeechRef.current) {
          setAssistantThinking(true);
          clearThinkTimeout();
          thinkTimeoutRef.current = setTimeout(() => {
            setAssistantThinking(false);
          }, 15000);
        }
      }

      if (botIsNowSpeaking) {
        setAssistantThinking(false);
        clearThinkTimeout();
      }

      wasLocalSpeakingRef.current = localIsNowSpeaking;
    };

    props.room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    return () => {
      clearThinkTimeout();
      props.room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    };
  }, [props.room]);

  const aiState = assistantSpeaking ? 'speaking' : assistantThinking ? 'thinking' : 'idle';
  const aiLabel =
    aiState === 'speaking' ? 'AI speaking' : aiState === 'thinking' ? 'AI processing...' : 'AI ready';

  return (
    <div className="bc-status-hud" aria-live="polite">
      {isRecording ? (
        <div className="bc-record-live" role="status" aria-live="polite">
          <span className="bc-dot is-recording" />
          <span>REC</span>
        </div>
      ) : null}
      <div className="bc-status-stack">
        <div className={`bc-status-pill ${localSpeaking ? 'is-speaking' : ''}`}>
          <span className="bc-dot" />
          <span>{localSpeaking ? 'You are speaking' : 'Mic on'}</span>
        </div>
        <div className={`bc-status-pill ai ${aiState === 'speaking' ? 'is-speaking' : ''}`}>
          <span className={`bc-dot ${aiState === 'thinking' ? 'is-thinking' : ''}`} />
          <span>{aiLabel}</span>
        </div>
      </div>
    </div>
  );
}
