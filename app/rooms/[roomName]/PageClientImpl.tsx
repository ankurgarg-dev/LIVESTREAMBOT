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
  LocalAudioTrack,
  RoomOptions,
  Track,
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
const MEDIA_MODE_PREFERENCE =
  String(process.env.NEXT_PUBLIC_AGENT_MEDIA_MODE || 'direct').trim().toLowerCase() === 'relay' ? 'relay' : 'direct';

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
  joinRole: 'candidate' | 'moderator';
}) {
  const contextPublishedRef = React.useRef(false);
  const localTracksEnabledRef = React.useRef(false);
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
        const urls = getConnectionUrlFallbacks(props.connectionDetails.serverUrl);
        let lastError: unknown = undefined;
        for (const serverUrl of urls) {
          try {
            await room.connect(serverUrl, props.connectionDetails.participantToken, connectOptions);
            return;
          } catch (error) {
            lastError = error;
            console.error('[room] connect failed for url:', serverUrl, error);
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
    props.userChoices,
    publishInterviewContextBestEffort,
    room,
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
    if (MEDIA_MODE_PREFERENCE !== 'direct') return;
    if (props.connectionDetails.interviewContext?.agentType !== 'realtime_screening') return;

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let ownedStream: MediaStream | null = null;
    let remoteAudioEl: HTMLAudioElement | null = null;
    let oaiEventsDc: RTCDataChannel | null = null;
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
            mode: ready ? 'direct' : 'relay',
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

    const setupDirectMedia = async () => {
      if (cancelled || room.state !== ConnectionState.Connected) return;
      if (pc) return;

      try {
        let mediaTrack: MediaStreamTrack | undefined;
        const localMicPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const localMicTrack = localMicPublication?.track as LocalAudioTrack | undefined;
        if (localMicTrack?.mediaStreamTrack) {
          mediaTrack = localMicTrack.mediaStreamTrack;
        }

        if (!mediaTrack) {
          ownedStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: props.userChoices.audioDeviceId || undefined,
            },
            video: false,
          });
          mediaTrack = ownedStream.getAudioTracks()[0];
        }

        if (!mediaTrack) throw new Error('No local audio track available for direct media path');

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

        pc = new RTCPeerConnection();
        remoteAudioEl = new Audio();
        remoteAudioEl.autoplay = true;
        remoteAudioEl.setAttribute('playsinline', 'true');

        pc.ontrack = (event) => {
          const [stream] = event.streams;
          if (!stream || !remoteAudioEl) return;
          remoteAudioEl.srcObject = stream;
          remoteAudioEl.play().catch(() => undefined);
        };

        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
            void publishClientMediaState(false, `pc_${pc.connectionState}`);
          }
        };

        pc.addTrack(mediaTrack, new MediaStream([mediaTrack]));
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
            const maybeQuestion = extractQuestion(assistantText);
            if (maybeQuestion) currentQuestion = maybeQuestion;
            const maybeSkill = detectMustHaveInText(assistantText);
            if (maybeSkill) {
              currentSkill = maybeSkill;
              currentTopic = maybeSkill;
            }
            return;
          }

          if (parsed?.type !== 'conversation.item.input_audio_transcription.completed') return;
          const transcriptText = String(parsed?.transcript || '').trim();
          if (!transcriptText) return;

          void (async () => {
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
              sendRealtimeEvent({
                type: 'response.create',
                response: {
                  modalities: ['audio', 'text'],
                },
              });
            } catch (error) {
              console.error('[direct-media] turn gate failed:', error);
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
              sendRealtimeEvent({
                type: 'response.create',
                response: {
                  modalities: ['audio', 'text'],
                },
              });
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

        await publishClientMediaState(true, 'connected');
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

    room.on(RoomEvent.Connected, onConnected);
    if (room.state === ConnectionState.Connected) {
      onConnected();
    }

    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, onConnected);
      void publishClientMediaState(false, 'cleanup');
      try {
        pc?.close();
      } catch {
        // ignore close errors
      }
      if (ownedStream) {
        for (const track of ownedStream.getTracks()) {
          track.stop();
        }
      }
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
        <InRoomStatusHud room={room} />
        <KeyboardShortcuts />
        <BristleconeVideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
          isModerator={props.joinRole === 'moderator'}
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
