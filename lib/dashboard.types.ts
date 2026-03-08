import { type PositionConfigCore } from './position/types';

export type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | '';
export type AgentType = 'classic' | 'realtime_screening';
export type MainTab = 'dashboard' | 'positions' | 'candidates' | 'applications' | 'interviews' | 'settings';
export type SkillCalibrationCategory = 'must_have' | 'nice_to_have';
export type SkillCalibrationItem = {
    skill: string;
    category: SkillCalibrationCategory;
    definition: string;
    weight_percent: number;
};
export type AgentPromptSettings = {
    classicPrompt: string;
    realtimePrompt: string;
    screeningMaxMinutes: number;
    sttVadRmsThreshold: number;
    sttMinSpeechMs: number;
    sttMaxSilenceMs: number;
    sttMaxUtteranceMs: number;
    sttMinTranscribeMs: number;
    sttGraceMs: number;
    updatedAt?: string;
};

export const DEFAULT_AGENT_SETTINGS: AgentPromptSettings = {
    classicPrompt: '',
    realtimePrompt: '',
    screeningMaxMinutes: 10,
    sttVadRmsThreshold: 0.0035,
    sttMinSpeechMs: 350,
    sttMaxSilenceMs: 900,
    sttMaxUtteranceMs: 30000,
    sttMinTranscribeMs: 400,
    sttGraceMs: 350,
};

export type InterviewAssetMeta = {
    originalName: string;
    storedName: string;
    contentType: string;
    size: number;
};

export type CvJdSkillScore = {
    skill: string;
    category: 'must_have' | 'common';
    matched: boolean;
    matchType: 'exact' | 'partial' | 'none';
    score: number;
    oneLiner: string;
};

export type CvJdScorecard = {
    overallScore: number;
    mustHaveScore: number;
    commonSkillScore: number;
    mustHaveMatched: number;
    mustHaveTotal: number;
    commonMatched: number;
    commonTotal: number;
    summary: string;
    details: CvJdSkillScore[];
};

export type InterviewRecord = {
    id: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    roomName: string;
    candidateName: string;
    candidateEmail: string;
    interviewerName: string;
    interviewerEmail: string;
    jobTitle: string;
    jobDepartment: string;
    scheduledAt: string;
    durationMinutes: number;
    timezone: string;
    notes: string;
    agentType: AgentType;
    positionId?: string;
    positionSnapshot?: PositionConfigCore;
    cv?: InterviewAssetMeta;
    jd?: InterviewAssetMeta;
    meetingActualStart?: string;
    meetingActualEnd?: string;
    participantsJoined?: string;
    recordingUrl?: string;
    rubricScore?: number;
    interviewScore?: number;
    recommendation?: Recommendation;
    summaryFeedback?: string;
    detailedFeedback?: string;
    nextSteps?: string;
    transcriptText?: string;
    cvJdScorecard?: CvJdScorecard;
    createdAt: string;
    updatedAt: string;
};

export type PositionRecord = PositionConfigCore & {
    position_id: string;
    created_at: string;
    updated_at: string;
    version: number;
};

export type CandidateProfile = {
    id: string;
    fullName: string;
    email: string;
    currentTitle?: string;
    yearsExperience?: string;
    keySkills?: string[];
    candidateContext?: string;
    createdAt: string;
    updatedAt: string;
};

export type CandidateScreening = {
    candidateId: string;
    positionId: string;
    recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
    conclusion: string;
    blendedScore?: number;
    blendedRecommendation?: 'strong_fit' | 'fit' | 'borderline' | 'reject';
    updatedAt?: string;
    cvJdScorecard?: CvJdScorecard;
    aiScreening?: {
        score: number;
        summary: string;
        strengths: string[];
        gaps: string[];
        reasoning: string[];
        model: string;
    };
};

export type ApplicationRecord = {
    id: string;
    positionId: string;
    candidateId?: string;
    candidateName: string;
    candidateEmail: string;
    recommendation: 'strong_fit' | 'fit' | 'borderline' | 'reject';
    conclusion: string;
    blendedScore?: number;
    blendedRecommendation?: 'strong_fit' | 'fit' | 'borderline' | 'reject';
    roomName?: string;
    interviewAgentType?: AgentType;
    createdAt: string;
    updatedAt: string;
};

export type SetupFormState = {
    candidateName: string;
    candidateEmail: string;
    interviewerName: string;
    interviewerEmail: string;
    jobDepartment: string;
    scheduledDate: string;
    scheduledTime: string;
    timezone: string;
    roomName: string;
    notes: string;
    agentType: AgentType;
};
