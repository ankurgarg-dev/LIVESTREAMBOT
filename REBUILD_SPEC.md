# Bristlecone Interview Platform Rebuild Spec

## 1. Purpose
This document defines the full implementation scope needed to recreate this project from scratch.
Use it as the source of truth for a clean rebuild with Codex.

## 2. Product Summary
The product is an interview operations platform built on top of LiveKit + Next.js.
It supports candidate intake, JD-to-position setup, CV/JD scoring, AI-assisted screening, interview orchestration, LiveKit room joining, optional recording to S3, and downloadable interview artifacts.

## 3. Core User Workflows
1. Create or import a Position from JD text/file, review extracted fields, and save normalized config.
2. Upload Candidate CV, auto-extract profile/context, and optionally apply candidate to a Position.
3. Run screening for candidate+position and persist deterministic + AI-assisted scores.
4. Convert screened candidate to an Application and auto-create an Interview shell.
5. Join interview room as candidate/moderator; backend auto-mints token and asks agent-service to join.
6. Conduct interview in either `classic` or `realtime_screening` mode.
7. Persist interview outcomes and download report/transcript/recording links.
8. Manage skill canonicalization rules (skills, aliases, block rules), including JD/CV-assisted import.

## 4. Functional Scope
### 4.1 Frontend Pages
Implement these pages:
- `/` dashboard with tabs: `dashboard`, `positions`, `candidates`, `applications`, `interviews`, `settings`.
- `/positions/new` create/edit position workflow with JD prefill + deterministic mapping adjustments.
- `/candidates` candidate intake form (CV upload, optional position selection).
- `/candidates/screening` detailed screening results page.
- `/rooms/[roomName]` pre-join + full interview room UI.
- `/canonicalizations` skill/alias/block-rule management + JD/CV import actions.
- `/visualizer` voice visualizer demo page.
- `/custom` custom conference page variant.

### 4.2 Interview Room Capabilities
Implement in room client:
- LiveKit prejoin + connect flow.
- Role metadata in connection request (`candidate` or `moderator`).
- Agent type propagation (`classic` / `realtime_screening`).
- Recording controls (`start/stop`) via API.
- Moderator pause/resume controls.
- Optional auto-record behavior with env toggle.
- Visualizer/orb states for speaking/assistant status.

### 4.3 AI/Screening Features
Implement:
- Deterministic CV/JD scorecard generation.
- Detailed scorecard across must-have/nice-to-have/tech/focus areas.
- AI screening call using OpenAI text model with fallback handling.
- Blended score/recommendation combining deterministic + AI score.
- Realtime screening helpers:
- Ephemeral realtime session provisioning endpoint.
- Turn-gating endpoint for off-topic/drift/voice-control handling.

### 4.4 Skill Canonicalization Features
Implement skill normalization subsystem with:
- Canonical skills table.
- Alias matching modes (`EXACT`, `PHRASE`, `REGEX`).
- Block rules to suppress false mappings.
- Tenant-aware filtering (`tenantId` nullable/global).
- JD import to seed/update skills.
- CV analysis producing suggestions (`add_alias`, `add_skill`) and apply flow.

## 5. Technical Architecture
### 5.1 App Stack
- Next.js App Router (v15.x), React 18, TypeScript strict mode.
- LiveKit components/client SDK for RTC UI.
- Prisma + SQLite for persistence.
- Optional secondary Node service (`agent-service`) for AI agent media/control loop.

### 5.2 Main Runtime Components
- `web-app`: Next.js app serving UI + API routes.
- `db`: SQLite file at `DATABASE_URL` (default `.runtime/interviewbot.db`).
- `agent-service`: Node process that can join rooms and drive interview audio/LLM/TTS.
- `livekit-server`: local dev or cloud LiveKit endpoint.
- `recording-egress`: LiveKit egress to S3-compatible storage.

### 5.3 Storage Model
Primary persistence is Prisma models with JSON payload fields.
Asset files are stored on local disk under `INTERVIEW_DATA_DIR` (default `~/.bristlecone-data/interviews`) for uploaded CV/JD files linked from records.

## 6. Data Model (Prisma)
Recreate these models:
- `Interview` (id, roomName, candidateName, status, agentType, timestamps, payload JSON).
- `Position` (id, roleTitle, timestamps, payload JSON).
- `Candidate` (id, fullName, email, timestamps, payload JSON).
- `CandidateApplication` (id, positionId, candidateId nullable, candidateName, candidateEmail, scores, timestamps, payload JSON, unique candidateId+positionId).
- `AgentSetting` (single-row settings payload JSON).
- `Skill`.
- `SkillAlias`.
- `SkillBlockRule`.
- `SkillRulesetVersion`.

Indexes to preserve:
- Interview by `roomName, updatedAt desc` and `updatedAt desc`.
- Candidate by `email`, `updatedAt desc`.
- CandidateApplication by `positionId`, `candidateId`, `updatedAt` and unique `(candidateId, positionId)`.
- Skill/alias/block rule lookup indexes for canonicalization performance.

## 7. API Surface (must recreate)
### 7.1 RTC / Interview Runtime
- `GET /api/connection-details`
- `POST /api/openai/realtime-session`
- `POST /api/openai/realtime-turn-gate`
- `GET|POST /api/record/start`
- `GET|POST /api/record/stop`
- `GET /api/record/status`

### 7.2 Positions
- `GET|POST /api/positions`
- `GET|PATCH|DELETE /api/positions/[id]`
- `POST /api/positions/prefill`

### 7.3 Candidates / Applications
- `GET|POST /api/candidates`
- `GET /api/candidates/[id]`
- `GET /api/candidates/[id]/asset`
- `POST /api/candidates/prefill`
- `POST /api/candidates/apply`
- `GET /api/applications`
- `GET|PATCH|DELETE /api/applications/[id]`

### 7.4 Interviews
- `GET|POST /api/interviews`
- `GET|PATCH|DELETE /api/interviews/[id]`
- `GET /api/interviews/[id]/asset`
- `GET /api/interviews/[id]/download` (`kind=report|transcript|recording`)

### 7.5 Skills / Canonicalization / Agent Settings
- `GET|POST /api/skills`
- `PATCH|DELETE /api/skills/[id]`
- `POST /api/skills/aliases`
- `PATCH|DELETE /api/skills/aliases/[id]`
- `POST /api/skills/block-rules`
- `PATCH|DELETE /api/skills/block-rules/[id]`
- `POST /api/skills/import-jd`
- `POST|PUT /api/skills/import-cv`
- `GET|PATCH /api/agent-settings`

## 8. Key Domain Logic To Preserve
- CV/JD deterministic scoring and recommendation thresholds.
- Must-have weighted scoring policy (dominant contribution).
- Auto-creation rules:
- Creating applications may auto-create interviews.
- Joining room can backfill interview from application if missing.
- Canonicalization precedence:
- Alias confidence ranking.
- Match type ranking `EXACT > PHRASE > REGEX`.
- Block rules can suppress otherwise matched skills.
- Interview download report synthesizes structured assessment fallback if explicit report missing.

## 9. Environment Variables
### 9.1 Web App Required
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`
- `OPENAI_API_KEY`
- `DATABASE_URL` (default fallback exists)

### 9.2 Web App Optional
- `OPENAI_PREFILL_MODEL`
- `NEXT_PUBLIC_LK_RECORD_ENDPOINT`
- `NEXT_PUBLIC_AUTO_RECORD_INTERVIEW`
- `NEXT_PUBLIC_SHOW_SETTINGS_MENU`
- `NEXT_PUBLIC_AGENT_MEDIA_MODE`
- `AGENT_CONTROL_URL`
- `AGENT_CONTROL_TOKEN`
- `AGENT_CONTROL_TIMEOUT_MS`
- Recording envs: `RECORDING_S3_BUCKET`, `RECORDING_S3_REGION`, `RECORDING_S3_ENDPOINT`, `RECORDING_S3_PREFIX`, `RECORDING_LAYOUT`, `RECORDING_LIVEKIT_URL`, optional explicit S3 creds.

### 9.3 Agent Service Required
- `OPENAI_API_KEY`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

### 9.4 Agent Service Optional
- `LIVEKIT_ROOM`
- `BOT_IDENTITY`, `BOT_NAME`
- `AGENT_AUTO_JOIN_DEFAULT_ROOM`
- `AGENT_CONTROL_ENABLED`, `AGENT_CONTROL_HOST`, `AGENT_CONTROL_PORT`, `AGENT_CONTROL_TOKEN`
- `OPENAI_MODEL`, `OPENAI_REALTIME_SCREENING_MODEL`, `OPENAI_REALTIME_SCREENING_FALLBACK_MODEL`
- `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE*`, `OPENAI_STT_MODEL`
- STT/VAD tuning vars (`STT_*`, `REALTIME_SERVER_VAD_THRESHOLD`)
- `AGENT_MEDIA_MODE`

## 10. Non-Functional Requirements
- Node >= 18 (CI currently uses Node 22).
- Package manager: pnpm (`pnpm@10.18.2`).
- Strict TypeScript build without emit.
- ESLint + Prettier checks in CI.
- Vitest test command present.
- No hard dependency on generated Prisma client at import time before generation.
- Graceful degradation when optional services fail (agent control, room pre-create, AI call failures).

## 11. Infra + Deployment Scope
Implement both local and EC2 deploy paths.

Local:
- LiveKit dev server (`livekit-server --dev`).
- Next dev server (`pnpm dev`).
- Prisma generate/push flow.

EC2:
- One-time bootstrap script installing deps, cloning repo, installing systemd units/envs.
- Remote deploy script via SSM: pull latest, install deps, prisma generate/push, build, restart services.
- Optional agent restart behind flag (`DEPLOY_ENABLE_AGENT`).
- GitHub Actions workflows:
- `Test` workflow: lint, format check, tests.
- `Deploy To EC2` workflow triggered by successful test on `main` or manual dispatch.

## 12. Build Order For Reimplementation
1. Initialize Next.js app, dependencies, lint/test/format config.
2. Add Prisma schema + migrations + base DB wiring.
3. Implement core stores (`position`, `candidate`, `interview`, `settings`).
4. Implement API routes for positions/candidates/interviews/applications.
5. Implement dashboard + positions + candidates UI.
6. Implement LiveKit room join flow and `connection-details` token endpoint.
7. Implement canonicalization subsystem + admin page.
8. Implement recording APIs + S3 egress integration.
9. Add OpenAI prefill/screening + realtime endpoints.
10. Add agent-service with control endpoint contract.
11. Add deployment scripts + CI workflows.
12. Add regression tests for scoring, mapping, and route-level critical paths.

## 13. Acceptance Checklist
A rebuild is complete only when all are true:
- Position can be created from JD text/file and edited.
- Candidate CV upload creates profile and can create application.
- Screening works with deterministic score; AI score fallback does not break flow.
- Application can produce an interview and room can be joined.
- `connection-details` returns valid LiveKit token and context payload.
- Classic and realtime screening agent modes are selectable and persisted.
- Interview artifacts download endpoints work (`report`, `transcript`, `recording` redirect).
- Skill canonicalization CRUD + JD/CV import works end-to-end.
- Prisma DB initializes from empty state on a fresh machine.
- CI test workflow passes.
- EC2 deploy script can perform remote pull/build/restart successfully.

## 14. Deliberate Exclusions For First Rebuild Cut
You can postpone these to v2 if needed:
- Advanced visualizer polish beyond basic functioning.
- Datadog browser logs plumbing.
- Multi-tenant skill rules beyond nullable/global tenant behavior.
- Non-SQLite databases.

## 15. Suggested Rebuild Deliverables
Ask Codex to generate these artifacts in the new repo:
- `ARCHITECTURE.md` (component + sequence diagrams).
- `API_CONTRACT.md` (request/response examples for every route).
- `DATA_MODEL.md` (Prisma + JSON payload shapes).
- `ENVIRONMENT.md` (all variables with required/optional/default).
- `RUNBOOK.md` (local dev, troubleshooting, deploy).
- `QA_CHECKLIST.md` (manual verification matrix).
