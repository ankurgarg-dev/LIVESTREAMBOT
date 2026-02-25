import CandidateScreeningClient from './screening-client';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CandidateScreeningPage({ searchParams }: PageProps) {
  const resolved = (await searchParams) || {};
  const candidateIdRaw = resolved.candidateId;
  const positionIdRaw = resolved.positionId;
  const candidateId = String(Array.isArray(candidateIdRaw) ? candidateIdRaw[0] : candidateIdRaw || '').trim();
  const positionId = String(Array.isArray(positionIdRaw) ? positionIdRaw[0] : positionIdRaw || '').trim();

  return <CandidateScreeningClient candidateId={candidateId} positionId={positionId} />;
}
