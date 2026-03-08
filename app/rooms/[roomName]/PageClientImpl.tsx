'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/components/Debug';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { RecordingIndicator } from '@/components/RecordingIndicator';
import { SettingsMenu } from '@/components/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
} from '@livekit/components-react';
import {
  ConnectionState,
  ExternalE2EEKeyProvider,
  LocalAudioTrack,
  RoomOptions,
  Track,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  ParticipantEvent,
  TrackPublishDefaults,
  VideoCaptureOptions,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import { BristleconeVideoConference } from '@/components/BristleconeVideoConference';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU !== 'false';
const RECORDING_ENDPOINT = process.env.NEXT_PUBLIC_LK_RECORD_ENDPOINT ?? '/api/record';
const AUTO_RECORD_INTERVIEW = process.env.NEXT_PUBLIC_AUTO_RECORD_INTERVIEW === 'true';
const MEDIA_MODE_PREFERENCE = 'direct';
// TODO(remove after transcript rollout): delete temporary post-transcript turn-gate flow.
const ENABLE_TRANSCRIPT_POST_GATE_FLOW = false;

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  autoJoin?: boolean;
  participantName?: string;
  agentType?: 'classic' | 'realtime_screening';
  joinRole?: 'candidate' | 'moderator';
}) {
  const router = useRouter();
  const [roomDraft, setRoomDraft] = React.useState(props.roomName);
  const [autoJoinDisabled, setAutoJoinDisabled] = React.useState(false);
  const [autoJoinError, setAutoJoinError] = React.useState('');
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const [joinRole, setJoinRole] = React.useState<'candidate' | 'moderator'>(props.joinRole || 'candidate');
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: props.participantName?.trim() || '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, [props.participantName]);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const fetchConnectionDetails = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    url.searchParams.append('metadata', JSON.stringify({ role: joinRole }));
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    if (props.agentType === 'realtime_screening') {
      url.searchParams.append('agentType', props.agentType);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const raw = await connectionDetailsResp.text();
    let connectionDetailsData: any = {};
    try {
      connectionDetailsData = raw ? JSON.parse(raw) : {};
    } catch {
      connectionDetailsData = { error: raw || 'Failed to parse connection-details response' };
    }
    if (!connectionDetailsResp.ok) {
      throw new Error(connectionDetailsData?.error || connectionDetailsData?.message || 'Failed to join room');
    }
    setConnectionDetails(connectionDetailsData);
  }, [joinRole, props.agentType, props.region, props.roomName]);
  const handlePreJoinSubmit = React.useCallback(
    async (values: LocalUserChoices) => {
      setAutoJoinError('');
      await fetchConnectionDetails(values);
    },
    [fetchConnectionDetails],
  );
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);
  const retryAutoJoin = React.useCallback(() => {
    setAutoJoinError('');
    setAutoJoinDisabled(false);
  }, []);
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
                {autoJoinError ? (
                  <p style={{ margin: '0 0 0.6rem 0', color: '#b33a3a' }}>
                    {`Auto-join failed: ${autoJoinError}`}
                  </p>
                ) : null}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: props.autoJoin ? '1fr auto auto auto auto' : '1fr auto auto auto',
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
                  <select
                    value={joinRole}
                    onChange={(e) => setJoinRole(e.target.value === 'moderator' ? 'moderator' : 'candidate')}
                    aria-label="Join role"
                  >
                    <option value="candidate">Join as Candidate</option>
                    <option value="moderator">Join as Moderator</option>
                  </select>
                  <button className="lk-button" onClick={() => router.push('/')}>
                    Cancel
                  </button>
                  {props.autoJoin ? (
                    <button className="lk-button" onClick={retryAutoJoin}>
                      Retry Auto Join
                    </button>
                  ) : null}
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
          joinRole={joinRole}
          requestedAgentType={props.agentType}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  requestedAgentType?: 'classic' | 'realtime_screening';
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
  joinRole: 'candidate' | 'moderator';
}) {
  const contextPublishedRef = React.useRef(false);
  const localTracksEnabledRef = React.useRef(false);
  const disconnectNoticeRef = React.useRef('');
  React.useEffect(() => {
    contextPublishedRef.current = false;
    localTracksEnabledRef.current = false;
  }, [props.connectionDetails.roomName, props.connectionDetails.participantToken]);
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

  const getConnectionUrlFallbacks = (primary: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: string) => {
      const v = String(value || '').trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    };
    push(primary);
    try {
      const url = new URL(primary);
      if (url.pathname && url.pathname !== '/') {
        const noPath = new URL(primary);
        noPath.pathname = '/';
        noPath.search = '';
        noPath.hash = '';
        push(noPath.toString());
      }
      if (url.protocol === 'wss:') {
        const ws = new URL(primary);
        ws.protocol = 'ws:';
        push(ws.toString());
      } else if (url.protocol === 'ws:') {
        const wss = new URL(primary);
        wss.protocol = 'wss:';
        push(wss.toString());
      }
    } catch {
      // ignore parse failures
    }
    return out;
  };

  const isRetryableAuthConnectError = React.useCallback((error: unknown): boolean => {
    const message = String((error as { message?: unknown })?.message || error || '').toLowerCase();
    return (
      message.includes('could not authenticate') ||
      message.includes('status 404') ||
      message.includes('not found') ||
      message.includes('unauthorized') ||
      message.includes('token')
    );
  }, []);

  const fetchFreshConnectionDetails = React.useCallback(async (): Promise<ConnectionDetails | null> => {
    try {
      const participantName = (props.connectionDetails.participantName || props.userChoices.username || '').trim();
      if (!participantName) return null;
      const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
      url.searchParams.set('roomName', props.connectionDetails.roomName);
      url.searchParams.set('participantName', participantName);
      url.searchParams.set('metadata', JSON.stringify({ role: props.joinRole }));
      if (props.requestedAgentType === 'realtime_screening') {
        url.searchParams.set('agentType', 'realtime_screening');
      }
      const response = await fetch(url.toString());
      if (!response.ok) return null;
      const nextDetails = (await response.json()) as ConnectionDetails;
      if (!nextDetails?.serverUrl || !nextDetails?.participantToken) return null;
      return nextDetails;
    } catch (error) {
      console.warn('[room] refresh connection-details failed:', error);
      return null;
    }
  }, [
    props.connectionDetails.participantName,
    props.connectionDetails.roomName,
    props.joinRole,
    props.requestedAgentType,
    props.userChoices.username,
  ]);

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

  const publishInterviewContextBestEffort = React.useCallback(async () => {
    if (contextPublishedRef.current) return;
    const payload = props.connectionDetails.interviewContext;
    const cv = String(payload?.candidateContext || '').trim();
    const role = String(payload?.roleContext || '').trim();
    if (!cv && !role) return;

    const contextMessage = {
      interviewId: payload?.interviewId || '',
      agentType: payload?.agentType || 'classic',
      cv,
      role,
      mustHaveSkills: Array.isArray(payload?.mustHaveSkills) ? payload.mustHaveSkills : [],
      requiredTechStack: Array.isArray(payload?.requiredTechStack) ? payload.requiredTechStack : [],
      goodToHaveSkills: Array.isArray(payload?.goodToHaveSkills) ? payload.goodToHaveSkills : [],
      currentQuestion: String(payload?.currentQuestion || '').trim(),
      currentSkill: String(payload?.currentSkill || '').trim(),
      currentTopic: String(payload?.currentTopic || '').trim(),
      context: { cv, role },
    };
    const data = new TextEncoder().encode(JSON.stringify(contextMessage));

    const tryPublish = async () => {
      await room.localParticipant.publishData(data, { reliable: true });
      contextPublishedRef.current = true;
    };

    try {
      await tryPublish();
      return;
    } catch {
      // Retry to handle initial race where data channel is not ready yet.
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      try {
        await tryPublish();
        return;
      } catch {
        // continue retries
      }
    }
  }, [props.connectionDetails.interviewContext, room]);

  const startRecordingBestEffort = React.useCallback(async () => {
    if (room.isE2EEEnabled) return;
    if (!room.name) return;
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
      if (!room.name) return;
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
  const router = useRouter();
  const handleOnLeave = React.useCallback(() => {
    const notice = disconnectNoticeRef.current.trim();
    if (notice) {
      alert(notice);
      disconnectNoticeRef.current = '';
    }
    router.push('/');
  }, [router]);
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
    const handleDataReceived = (payload: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(payload).trim();
        if (!text.startsWith('{')) return;
        const parsed = JSON.parse(text);
        if (parsed?.type !== 'interview_notice') return;
        const reason = String(parsed?.reason || '').trim();
        const message = String(parsed?.message || '').trim();
        if (reason === 'screening_time_limit') {
          disconnectNoticeRef.current =
            message || 'Interview time limit reached. The session has ended and your transcript is being finalized.';
        }
      } catch {
        // Ignore non-JSON or malformed payloads.
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);
    const enableLocalTracksBestEffort = () => {
      if (localTracksEnabledRef.current) return;
      localTracksEnabledRef.current = true;
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
    };
    const handleConnected = () => {
      enableLocalTracksBestEffort();
      publishInterviewContextBestEffort().catch((error) =>
        console.error('[room] interview context publish failed:', error),
      );
    };

    if (e2eeSetupComplete) {
      room.on(RoomEvent.Connected, handleConnected);
      const connectWithFallbacks = async () => {
        const connectUsingDetails = async (details: ConnectionDetails) => {
          const urls = getConnectionUrlFallbacks(details.serverUrl);
          let attemptError: unknown = undefined;
          for (const serverUrl of urls) {
            try {
              await room.connect(serverUrl, details.participantToken, connectOptions);
              return;
            } catch (error) {
              attemptError = error;
              // Fallback probing can fail on some URLs/protocols before a later URL succeeds.
              // Keep this as a warning to avoid noisy dev error overlays for recoverable attempts.
              console.warn('[room] connect fallback failed for url:', serverUrl, error);
            }
          }
          throw attemptError instanceof Error ? attemptError : new Error('Failed to connect to LiveKit signaling server');
        };

        let lastError: unknown = undefined;
        try {
          await connectUsingDetails(props.connectionDetails);
          return;
        } catch (error) {
          lastError = error;
        }

        if (isRetryableAuthConnectError(lastError)) {
          const refreshed = await fetchFreshConnectionDetails();
          if (refreshed) {
            try {
              await connectUsingDetails(refreshed);
              return;
            } catch (retryError) {
              lastError = retryError;
            }
          }
        }

        throw lastError instanceof Error ? lastError : new Error('Failed to connect to LiveKit signaling server');
      };
      connectWithFallbacks().catch((error) => {
        handleError(error instanceof Error ? error : new Error(String(error || 'Failed to connect')));
      });
      if (room.state === ConnectionState.Connected) {
        handleConnected();
      }
    }
    return () => {
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.DataReceived, handleDataReceived);
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [
    connectOptions,
    e2eeSetupComplete,
    handleEncryptionError,
    handleError,
    handleOnLeave,
    props.connectionDetails,
    fetchFreshConnectionDetails,
    props.userChoices,
    publishInterviewContextBestEffort,
    room,
    isRetryableAuthConnectError,
  ]);

  const lowPowerMode = useLowCPUOptimizer(room);

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
    if (props.joinRole === 'moderator') return;
    if (props.connectionDetails.interviewContext?.agentType !== 'realtime_screening') return;

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let remoteAudioEl: HTMLAudioElement | null = null;
    let oaiEventsDc: RTCDataChannel | null = null;
    let directAgentVisualState: 'idle' | 'thinking' | 'speaking' = 'idle';
    const interviewId = String(props.connectionDetails.interviewContext?.interviewId || '').trim();
    const roomName = String(props.connectionDetails.roomName || '').trim();
    const MAX_TRANSCRIPT_BUFFER_ENTRIES = 5000;
    let transcriptBuffer: { role: 'candidate' | 'agent'; text: string; ts: string }[] = [];
    let transcriptFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let transcriptFlushInFlight = false;
    const seenTranscriptEventKeys = new Set<string>();
    let resolvedInterviewId = interviewId;
    let resolveInterviewIdPromise: Promise<string> | null = null;
    let micSender: RTCRtpSender | null = null;
    let botAudioContext: AudioContext | null = null;
    let botAudioSourceNode: MediaStreamAudioSourceNode | null = null;
    let botAudioGainNode: GainNode | null = null;
    let botAudioDestinationNode: MediaStreamAudioDestinationNode | null = null;
    let botAudioMediaTrack: MediaStreamTrack | null = null;
    let currentQuestion = String(props.connectionDetails.interviewContext?.currentQuestion || '').trim();
    let currentSkill = String(props.connectionDetails.interviewContext?.currentSkill || '').trim();
    let currentTopic = String(props.connectionDetails.interviewContext?.currentTopic || '').trim();
    const mustHaveSkills = Array.isArray(props.connectionDetails.interviewContext?.mustHaveSkills)
      ? props.connectionDetails.interviewContext.mustHaveSkills
      : [];
    const requiredTechStack = Array.isArray(props.connectionDetails.interviewContext?.requiredTechStack)
      ? props.connectionDetails.interviewContext.requiredTechStack
      : [];
    const goodToHaveSkills = Array.isArray(props.connectionDetails.interviewContext?.goodToHaveSkills)
      ? props.connectionDetails.interviewContext.goodToHaveSkills
      : [];
    if (!currentSkill && mustHaveSkills.length > 0) {
      currentSkill = String(mustHaveSkills[0] || '').trim();
      currentTopic = currentSkill;
    }

    const publishClientMediaState = async (ready: boolean, reason = '') => {
      if (room.state !== ConnectionState.Connected) return;
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({
            type: 'client_media_state',
            mode: 'direct',
            ready,
            reason,
            ts: new Date().toISOString(),
          }),
        );
        await room.localParticipant.publishData(payload, { reliable: true });
      } catch (error) {
        console.warn('[direct-media] failed to publish client media state:', error);
      }
    };

    const publishDirectAgentState = async (state: 'idle' | 'thinking' | 'speaking', reason = '') => {
      if (room.state !== ConnectionState.Connected) return;
      if (directAgentVisualState === state) return;
      directAgentVisualState = state;
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({
            type: 'direct_agent_state',
            state,
            reason,
            ts: new Date().toISOString(),
          }),
        );
        await room.localParticipant.publishData(payload, { reliable: false });
      } catch (error) {
        console.warn('[direct-media] failed to publish direct agent state:', error);
      }
    };

    const teardownDirectBotAudioTrack = async () => {
      try {
        if (botAudioMediaTrack) {
          await room.localParticipant.unpublishTrack(botAudioMediaTrack, true);
          const payload = new TextEncoder().encode(
            JSON.stringify({
              type: 'direct_bot_audio_track',
              source: 'direct_bot_audio',
              active: false,
              ts: new Date().toISOString(),
            }),
          );
          await room.localParticipant.publishData(payload, { reliable: false });
        }
      } catch {
        // Ignore unpublish errors during cleanup.
      }
      if (botAudioMediaTrack) {
        botAudioMediaTrack.stop();
      }
      botAudioMediaTrack = null;
      try {
        botAudioSourceNode?.disconnect();
        botAudioGainNode?.disconnect();
      } catch {
        // Ignore graph disconnect errors during cleanup.
      }
      botAudioSourceNode = null;
      botAudioGainNode = null;
      botAudioDestinationNode = null;
      if (botAudioContext) {
        await botAudioContext.close().catch(() => undefined);
      }
      botAudioContext = null;
    };

    const ensureDirectBotAudioTrack = async (stream: MediaStream) => {
      if (!stream.getAudioTracks().length) return;
      await teardownDirectBotAudioTrack();

      botAudioContext = new AudioContext();
      botAudioSourceNode = botAudioContext.createMediaStreamSource(stream);
      botAudioGainNode = botAudioContext.createGain();
      botAudioGainNode.gain.value = 1;
      botAudioDestinationNode = botAudioContext.createMediaStreamDestination();
      botAudioSourceNode.connect(botAudioGainNode);
      botAudioGainNode.connect(botAudioDestinationNode);

      if (botAudioContext.state !== 'running') {
        await botAudioContext.resume().catch(() => undefined);
      }

      const track = botAudioDestinationNode.stream.getAudioTracks()[0];
      if (!track) return;
      botAudioMediaTrack = track;
      await room.localParticipant.publishTrack(track, {
        name: 'ai-agent-audio-direct',
        source: Track.Source.Unknown,
        stream: 'ai-agent-direct',
      });
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({
            type: 'direct_bot_audio_track',
            source: 'direct_bot_audio',
            active: true,
            trackName: 'ai-agent-audio-direct',
            ts: new Date().toISOString(),
          }),
        );
        await room.localParticipant.publishData(payload, { reliable: false });
      } catch {
        // Ignore signaling failure; track publish is primary.
      }
      console.log('[direct-media] published bot audio track to LiveKit');
    };

    const ensureInterviewId = async (forceRefresh = false): Promise<string> => {
      if (!forceRefresh && resolvedInterviewId) return resolvedInterviewId;
      if (!roomName) return '';
      if (resolveInterviewIdPromise) return resolveInterviewIdPromise;

      resolveInterviewIdPromise = (async () => {
        try {
          const response = await fetch('/api/interviews', {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) return '';
          const json = await response.json().catch(() => ({}));
          const interviews = Array.isArray(json?.interviews) ? json.interviews : [];
          const match = interviews
            .filter((item: any) => String(item?.roomName || '').trim() === roomName)
            .sort((a: any, b: any) =>
              String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || '')),
            )[0];
          const nextId = String(match?.id || '').trim();
          if (nextId) resolvedInterviewId = nextId;
          return nextId;
        } catch {
          return '';
        } finally {
          resolveInterviewIdPromise = null;
        }
      })();

      return resolveInterviewIdPromise;
    };

    const postTranscriptBatch = async (
      entries: { role: 'candidate' | 'agent'; text: string; ts: string }[],
    ): Promise<boolean> => {
      if (entries.length === 0) return true;
      const targetInterviewId = resolvedInterviewId || (await ensureInterviewId());
      if (!targetInterviewId) return false;
      const response = await fetch(`/api/interviews/${encodeURIComponent(targetInterviewId)}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
        keepalive: true,
      });
      if (response.status === 404) {
        const refreshedInterviewId = await ensureInterviewId(true);
        if (!refreshedInterviewId) return false;
        const retryResponse = await fetch(`/api/interviews/${encodeURIComponent(refreshedInterviewId)}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }),
          keepalive: true,
        });
        if (!retryResponse.ok) {
          throw new Error(`transcript append failed with status ${retryResponse.status}`);
        }
        return true;
      }
      if (!response.ok) {
        throw new Error(`transcript append failed with status ${response.status}`);
      }
      return true;
    };

    const flushTranscriptBuffer = async () => {
      if (transcriptFlushInFlight || transcriptBuffer.length === 0) return;
      transcriptFlushInFlight = true;
      const batch = transcriptBuffer.splice(0, 80);
      try {
        const posted = await postTranscriptBatch(batch);
        if (!posted) {
          transcriptBuffer = [...batch, ...transcriptBuffer].slice(-MAX_TRANSCRIPT_BUFFER_ENTRIES);
        }
      } catch (error) {
        transcriptBuffer = [...batch, ...transcriptBuffer].slice(-MAX_TRANSCRIPT_BUFFER_ENTRIES);
        console.warn('[direct-media] transcript flush failed:', error);
      } finally {
        transcriptFlushInFlight = false;
        if (transcriptBuffer.length > 0) {
          transcriptFlushTimer = setTimeout(() => {
            transcriptFlushTimer = null;
            void flushTranscriptBuffer();
          }, 1200);
        }
      }
    };

    const enqueueTranscript = (
      role: 'candidate' | 'agent',
      text: string,
      eventKeyRaw?: string,
    ) => {
      const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
      if (!cleaned) return;

      const eventKey = `${role}:${String(eventKeyRaw || '').trim()}`;
      if (eventKeyRaw && seenTranscriptEventKeys.has(eventKey)) return;
      if (eventKeyRaw) {
        seenTranscriptEventKeys.add(eventKey);
        if (seenTranscriptEventKeys.size > 5000) {
          seenTranscriptEventKeys.clear();
        }
      }

      transcriptBuffer.push({
        role,
        text: cleaned.slice(0, 1200),
        ts: new Date().toISOString(),
      });
      if (transcriptBuffer.length > MAX_TRANSCRIPT_BUFFER_ENTRIES) {
        transcriptBuffer = transcriptBuffer.slice(-MAX_TRANSCRIPT_BUFFER_ENTRIES);
      }
      if (transcriptBuffer.length >= 6) {
        if (transcriptFlushTimer) {
          clearTimeout(transcriptFlushTimer);
          transcriptFlushTimer = null;
        }
        void flushTranscriptBuffer();
        return;
      }
      if (!transcriptFlushTimer) {
        transcriptFlushTimer = setTimeout(() => {
          transcriptFlushTimer = null;
          void flushTranscriptBuffer();
        }, 1200);
      }
    };

    const getLocalMicTrack = (): MediaStreamTrack | null => {
      const localMicPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (!localMicPublication || localMicPublication.isMuted) return null;
      const localMicTrack = localMicPublication.track as LocalAudioTrack | undefined;
      return localMicTrack?.mediaStreamTrack ?? null;
    };

    const syncDirectMicTrack = async (reason = '') => {
      if (!pc || !micSender) return;
      try {
        const nextTrack = getLocalMicTrack();
        await micSender.replaceTrack(nextTrack);
        if (nextTrack) {
          await publishClientMediaState(true, reason || 'local_mic_live');
        } else {
          await publishClientMediaState(false, reason || 'local_mic_muted');
        }
      } catch (error) {
        console.warn('[direct-media] failed to sync local mic track:', error);
      }
    };

    const sendRealtimeEvent = (event: Record<string, unknown>) => {
      const payload = JSON.stringify(event);
      if (!oaiEventsDc || oaiEventsDc.readyState !== 'open') return;
      oaiEventsDc.send(payload);
    };

    const extractQuestion = (text: string): string => {
      const chunks = String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const chunk of chunks) {
        if (chunk.includes('?')) return chunk.slice(0, 280);
      }
      return '';
    };

    const detectMustHaveInText = (text: string): string => {
      const normalized = String(text || '').toLowerCase();
      for (const skill of mustHaveSkills) {
        const trimmed = String(skill || '').trim();
        if (!trimmed) continue;
        if (normalized.includes(trimmed.toLowerCase())) return trimmed;
      }
      return '';
    };

    // TODO(remove after transcript rollout): delete this helper with post-transcript gate block below.
    const gateCommittedTranscript = async (text: string) => {
      const response = await fetch('/api/openai/realtime-turn-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          mustHaveSkills,
          requiredTechStack,
          goodToHaveSkills,
          currentQuestion,
          currentSkill,
          currentTopic,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(json?.error || 'Turn gate rejected transcript'));
      }
      return json as {
        ok?: boolean;
        action?: 'ALLOW' | 'REDIRECT';
        systemMessage?: string;
        currentQuestion?: string;
        currentSkill?: string;
        currentTopic?: string;
      };
    };
    let realtimeServerAutoResponse = false;
    const requestRealtimeResponse = () => {
      if (realtimeServerAutoResponse) return;
      sendRealtimeEvent({
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
        },
      });
    };
    let lastRealtimeResponseRequestedAt = 0;
    const requestRealtimeResponseWithCooldown = (reason: string) => {
      const now = Date.now();
      if (now - lastRealtimeResponseRequestedAt < 1500) return;
      lastRealtimeResponseRequestedAt = now;
      void publishDirectAgentState('thinking', reason);
      requestRealtimeResponse();
    };

    const setupDirectMedia = async () => {
      if (cancelled || room.state !== ConnectionState.Connected) return;
      if (pc) return;

      try {
        const tokenResponse = await fetch('/api/openai/realtime-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateContext: props.connectionDetails.interviewContext?.candidateContext || '',
            roleContext: props.connectionDetails.interviewContext?.roleContext || '',
            mustHaveSkills,
            requiredTechStack,
            goodToHaveSkills,
            currentQuestion,
            currentSkill,
            currentTopic,
          }),
        });
        const tokenJson = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokenJson?.ephemeralKey || !tokenJson?.model) {
          throw new Error(tokenJson?.error || 'Failed to mint realtime session token');
        }
        realtimeServerAutoResponse = Boolean(tokenJson?.createResponse);

        pc = new RTCPeerConnection();
        remoteAudioEl = new Audio();
        remoteAudioEl.autoplay = true;
        remoteAudioEl.setAttribute('playsinline', 'true');

        pc.ontrack = (event) => {
          const [stream] = event.streams;
          if (!stream || !remoteAudioEl) return;
          remoteAudioEl.srcObject = stream;
          remoteAudioEl.play().catch(() => undefined);
          void ensureDirectBotAudioTrack(stream).catch((error) => {
            console.warn('[direct-media] failed to publish bot audio track:', error);
          });
        };

        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
            void publishClientMediaState(false, `pc_${pc.connectionState}`);
          }
        };

        const micTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
        micSender = micTransceiver.sender;
        await syncDirectMicTrack('initial_sync');
        oaiEventsDc = pc.createDataChannel('oai-events');
        oaiEventsDc.onmessage = (messageEvent) => {
          if (cancelled) return;
          const raw = String(messageEvent.data || '').trim();
          if (!raw || !raw.startsWith('{')) return;
          let parsed: any = {};
          try {
            parsed = JSON.parse(raw);
          } catch {
            return;
          }

          if (parsed?.type === 'response.audio_transcript.done') {
            const assistantText = String(parsed?.transcript || '').trim();
            if (!assistantText) return;
            void publishDirectAgentState('idle', 'assistant_done');
            const assistantEventKey = String(
              parsed?.item_id || parsed?.response_id || parsed?.event_id || parsed?.id || '',
            ).trim();
            enqueueTranscript('agent', assistantText, assistantEventKey);
            const maybeQuestion = extractQuestion(assistantText);
            if (maybeQuestion) currentQuestion = maybeQuestion;
            const maybeSkill = detectMustHaveInText(assistantText);
            if (maybeSkill) {
              currentSkill = maybeSkill;
              currentTopic = maybeSkill;
            }
            return;
          }

          if (parsed?.type === 'response.audio.delta') {
            void publishDirectAgentState('speaking', 'assistant_audio_delta');
            return;
          }

          if (parsed?.type === 'response.audio.done') {
            void publishDirectAgentState('idle', 'assistant_audio_done');
            return;
          }

          if (parsed?.type === 'input_audio_buffer.speech_stopped') {
            requestRealtimeResponseWithCooldown('candidate_speech_stopped');
            return;
          }

          if (parsed?.type !== 'conversation.item.input_audio_transcription.completed') return;
          const transcriptText = String(parsed?.transcript || '').trim();
          if (!transcriptText) return;
          const candidateEventKey = String(
            parsed?.item_id || parsed?.event_id || parsed?.id || '',
          ).trim();
          enqueueTranscript('candidate', transcriptText, candidateEventKey);

          void (async () => {
            // TODO(remove after transcript rollout): when removing gate flow, keep transcript enqueue and response.create only.
            if (!ENABLE_TRANSCRIPT_POST_GATE_FLOW) {
              requestRealtimeResponseWithCooldown('transcript_completed_no_gate');
              return;
            }
            try {
              const decision = await gateCommittedTranscript(transcriptText);
              const gateSystemMessage = String(decision?.systemMessage || '').trim();
              if (gateSystemMessage) {
                sendRealtimeEvent({
                  type: 'conversation.item.create',
                  item: {
                    type: 'message',
                    role: 'system',
                    content: [{ type: 'input_text', text: gateSystemMessage }],
                  },
                });
              }
              const nextQuestion = String(decision?.currentQuestion || '').trim();
              const nextSkill = String(decision?.currentSkill || '').trim();
              const nextTopic = String(decision?.currentTopic || '').trim();
              if (nextQuestion) currentQuestion = nextQuestion;
              if (nextSkill) currentSkill = nextSkill;
              if (nextTopic) currentTopic = nextTopic;
              requestRealtimeResponseWithCooldown('transcript_completed_gate');
            } catch (error) {
              console.error('[direct-media] turn gate failed:', error);
              // TODO(remove after transcript rollout): remove fallback system injection with gate flow.
              sendRealtimeEvent({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'system',
                  content: [
                    {
                      type: 'input_text',
                      text:
                        'Interview mode. Keep the response focused on the current must-have skill and current interview question.',
                    },
                  ],
                },
              });
              requestRealtimeResponseWithCooldown('transcript_gate_fallback');
            }
          })();
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResponse = await fetch(
          `https://api.openai.com/v1/realtime?model=${encodeURIComponent(String(tokenJson.model))}`,
          {
            method: 'POST',
            body: offer.sdp || '',
            headers: {
              Authorization: `Bearer ${String(tokenJson.ephemeralKey)}`,
              'Content-Type': 'application/sdp',
            },
          },
        );
        if (!sdpResponse.ok) {
          const details = await sdpResponse.text().catch(() => '');
          throw new Error(`OpenAI realtime SDP exchange failed (${sdpResponse.status}): ${details}`);
        }
        const answerSdp = await sdpResponse.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        await syncDirectMicTrack('connected');
      } catch (error) {
        console.error('[direct-media] setup failed:', error);
        await publishClientMediaState(false, 'setup_failed');
      }
    };

    const onConnected = () => {
      setupDirectMedia().catch((error) => {
        console.error('[direct-media] connect handler failed:', error);
      });
    };

    const flushTranscriptOnPageHide = () => {
      const targetInterviewId = resolvedInterviewId;
      if (!targetInterviewId || transcriptBuffer.length === 0) return;
      const payload = JSON.stringify({ entries: transcriptBuffer.slice(0, 120) });
      const endpoint = `/api/interviews/${encodeURIComponent(targetInterviewId)}/transcript`;
      let sent = false;
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try {
          const blob = new Blob([payload], { type: 'application/json' });
          sent = navigator.sendBeacon(endpoint, blob);
        } catch {
          sent = false;
        }
      }
      if (!sent) {
        void fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      }
      transcriptBuffer = [];
    };

    const handleLocalMicPublicationEvent = (publication?: { source?: Track.Source }) => {
      if (publication && publication.source !== Track.Source.Microphone) return;
      void syncDirectMicTrack('local_mic_state_change');
    };

    room.on(RoomEvent.Connected, onConnected);
    room.localParticipant.on(ParticipantEvent.TrackMuted, handleLocalMicPublicationEvent);
    room.localParticipant.on(ParticipantEvent.TrackUnmuted, handleLocalMicPublicationEvent);
    room.localParticipant.on(ParticipantEvent.LocalTrackPublished, handleLocalMicPublicationEvent);
    room.localParticipant.on(ParticipantEvent.LocalTrackUnpublished, handleLocalMicPublicationEvent);
    window.addEventListener('pagehide', flushTranscriptOnPageHide);
    if (room.state === ConnectionState.Connected) {
      onConnected();
    }

    return () => {
      cancelled = true;
      if (transcriptFlushTimer) {
        clearTimeout(transcriptFlushTimer);
        transcriptFlushTimer = null;
      }
      void publishDirectAgentState('idle', 'cleanup');
      flushTranscriptOnPageHide();
      room.off(RoomEvent.Connected, onConnected);
      room.localParticipant.off(ParticipantEvent.TrackMuted, handleLocalMicPublicationEvent);
      room.localParticipant.off(ParticipantEvent.TrackUnmuted, handleLocalMicPublicationEvent);
      room.localParticipant.off(ParticipantEvent.LocalTrackPublished, handleLocalMicPublicationEvent);
      room.localParticipant.off(ParticipantEvent.LocalTrackUnpublished, handleLocalMicPublicationEvent);
      window.removeEventListener('pagehide', flushTranscriptOnPageHide);
      void publishClientMediaState(false, 'cleanup');
      try {
        pc?.close();
      } catch {
        // ignore close errors
      }
      void teardownDirectBotAudioTrack();
      if (remoteAudioEl) {
        remoteAudioEl.pause();
        remoteAudioEl.srcObject = null;
      }
      oaiEventsDc = null;
    };
  }, [props.connectionDetails.interviewContext, props.joinRole, props.userChoices.audioDeviceId, room]);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <BristleconeVideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
          isModerator={props.joinRole === 'moderator'}
          expectedAgentType={
            props.connectionDetails.interviewContext?.agentType === 'realtime_screening' ||
            props.requestedAgentType === 'realtime_screening'
              ? 'realtime_screening'
              : 'classic'
          }
        />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
