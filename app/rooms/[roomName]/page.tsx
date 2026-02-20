import * as React from 'react';
import { PageClientImpl } from './PageClientImpl';
import { isVideoCodec } from '@/lib/types';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    // FIXME: We should not allow values for regions if in playground mode.
    region?: string;
    hq?: string;
    codec?: string;
    autojoin?: string;
    name?: string;
    agentType?: string;
    role?: string;
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'vp9';
  const hq = _searchParams.hq === 'true' ? true : false;
  const autoJoin = _searchParams.autojoin === '1' || _searchParams.autojoin === 'true';
  const participantName = typeof _searchParams.name === 'string' ? _searchParams.name : undefined;
  const joinRole = _searchParams.role === 'moderator' ? 'moderator' : 'candidate';
  const agentType =
    _searchParams.agentType === 'realtime_screening' ? 'realtime_screening' : 'classic';

  return (
    <PageClientImpl
      roomName={_params.roomName}
      region={_searchParams.region}
      hq={hq}
      codec={codec}
      autoJoin={autoJoin}
      participantName={participantName}
      agentType={agentType}
      joinRole={joinRole}
    />
  );
}
