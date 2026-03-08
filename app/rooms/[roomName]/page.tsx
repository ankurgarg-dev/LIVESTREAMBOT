'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PageClientImpl } from './PageClientImpl';
import { isVideoCodec } from '@/lib/types';

export default function Page() {
  const params = useParams<{ roomName: string }>();
  const searchParams = useSearchParams();
  const roomName = params?.roomName || '';
  const region = searchParams.get('region') || undefined;
  const codecParam = searchParams.get('codec');
  const codec = codecParam && isVideoCodec(codecParam) ? codecParam : 'vp9';
  const hq = searchParams.get('hq') === 'true';
  const autoJoin = searchParams.get('autojoin') === '1' || searchParams.get('autojoin') === 'true';
  const participantName = searchParams.get('name') || undefined;
  const joinRole = searchParams.get('role') === 'moderator' ? 'moderator' : 'candidate';
  const agentType = searchParams.get('agentType') === 'realtime_screening' ? 'realtime_screening' : 'classic';

  return (
    <PageClientImpl
      roomName={roomName}
      region={region}
      hq={hq}
      codec={codec}
      autoJoin={autoJoin}
      participantName={participantName}
      agentType={agentType}
      joinRole={joinRole}
    />
  );
}
