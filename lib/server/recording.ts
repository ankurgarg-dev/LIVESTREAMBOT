import { EgressClient, EncodedFileOutput, S3Upload, type EgressInfo } from 'livekit-server-sdk';

type RecordingStartResult = {
  created: boolean;
  egress: EgressInfo;
  filepath: string | null;
};

const ACTIVE_EGRESS_STATUS_THRESHOLD = 2;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizedLiveKitHost(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  const path = parsed.pathname.replace(/\/+$/g, '');
  return path ? `${parsed.origin}${path}` : parsed.origin;
}

function sanitizePathFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, '-');
}

function buildS3Upload(): S3Upload {
  const bucket = getRecordingBucket();
  const region = getRecordingRegion();
  const endpoint = getRecordingEndpoint();
  const accessKey =
    process.env.RECORDING_S3_ACCESS_KEY_ID ??
    process.env.S3_KEY_ID ??
    process.env.AWS_ACCESS_KEY_ID;
  const secret =
    process.env.RECORDING_S3_SECRET_ACCESS_KEY ??
    process.env.S3_KEY_SECRET ??
    process.env.AWS_SECRET_ACCESS_KEY;

  if (!bucket) {
    throw new Error(
      'Missing recording bucket configuration. Set RECORDING_S3_BUCKET (or S3_BUCKET).',
    );
  }

  return new S3Upload({
    endpoint,
    accessKey,
    secret,
    region,
    bucket,
  });
}

function getRecordingBucket(): string | undefined {
  return process.env.RECORDING_S3_BUCKET ?? process.env.S3_BUCKET;
}

function getRecordingRegion(): string | undefined {
  return process.env.RECORDING_S3_REGION ?? process.env.S3_REGION;
}

function getRecordingEndpoint(): string | undefined {
  return process.env.RECORDING_S3_ENDPOINT ?? process.env.S3_ENDPOINT;
}

function buildFilePath(roomName: string): string {
  const prefix = (process.env.RECORDING_S3_PREFIX ?? 'recordings').replace(/^\/+|\/+$/g, '');
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}/${now}-${sanitizePathFragment(roomName)}.mp4`;
}

export function createEgressClient(): EgressClient {
  const livekitUrl =
    process.env.RECORDING_LIVEKIT_URL ?? process.env.LIVEKIT_EGRESS_URL ?? requireEnv('LIVEKIT_URL');
  const apiKey = requireEnv('LIVEKIT_API_KEY');
  const apiSecret = requireEnv('LIVEKIT_API_SECRET');
  return new EgressClient(normalizedLiveKitHost(livekitUrl), apiKey, apiSecret);
}

export async function listActiveRoomRecordings(
  egressClient: EgressClient,
  roomName: string,
): Promise<EgressInfo[]> {
  const all = await egressClient.listEgress({ roomName });
  return all.filter((info) => info.status < ACTIVE_EGRESS_STATUS_THRESHOLD);
}

export async function startRoomRecording(roomName: string): Promise<RecordingStartResult> {
  const egressClient = createEgressClient();
  const active = await listActiveRoomRecordings(egressClient, roomName);
  if (active.length > 0) {
    return { created: false, egress: active[0], filepath: null };
  }

  const filepath = buildFilePath(roomName);
  const file = new EncodedFileOutput({
    filepath,
    output: {
      case: 's3',
      value: buildS3Upload(),
    },
  });

  const egress = await egressClient.startRoomCompositeEgress(
    roomName,
    { file },
    {
      layout: process.env.RECORDING_LAYOUT ?? 'speaker',
    },
  );

  return {
    created: true,
    egress,
    filepath,
  };
}

export async function stopRoomRecording(roomName: string): Promise<number> {
  const egressClient = createEgressClient();
  const active = await listActiveRoomRecordings(egressClient, roomName);
  if (active.length === 0) return 0;
  await Promise.all(active.map((info) => egressClient.stopEgress(info.egressId)));
  return active.length;
}

export function extractEgressFilepath(info: EgressInfo): string | null {
  const raw =
    (info as unknown as { file?: { filepath?: string } }).file?.filepath ??
    (info as unknown as { filepath?: string }).filepath ??
    (Array.isArray((info as unknown as { fileResults?: Array<{ filename?: string }> }).fileResults)
      ? (info as unknown as { fileResults?: Array<{ filename?: string }> }).fileResults?.[0]?.filename
      : undefined);
  const filepath = String(raw || '').trim();
  return filepath || null;
}

export function buildRecordingPublicUrl(filepath: string): string | null {
  const normalizedPath = String(filepath || '').replace(/^\/+/, '');
  if (!normalizedPath) return null;

  const pathSegments = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const directBase = String(process.env.RECORDING_PUBLIC_BASE_URL || '').trim();
  if (directBase) {
    return `${directBase.replace(/\/+$/, '')}/${pathSegments}`;
  }

  const bucket = getRecordingBucket();
  if (!bucket) return null;

  const endpoint = String(getRecordingEndpoint() || '').trim();
  if (endpoint) {
    const base = endpoint.replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(bucket)}/${pathSegments}`;
  }

  const region = String(getRecordingRegion() || '').trim();
  if (region && region !== 'us-east-1') {
    return `https://${bucket}.s3.${region}.amazonaws.com/${pathSegments}`;
  }
  return `https://${bucket}.s3.amazonaws.com/${pathSegments}`;
}
