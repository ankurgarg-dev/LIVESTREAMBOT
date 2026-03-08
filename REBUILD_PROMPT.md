# Codex Kickoff Prompt For New Rebuild

Create a new project from scratch using the specification in `REBUILD_SPEC.md`.

Constraints:
- Use Next.js App Router + TypeScript + Prisma + SQLite.
- Preserve all functionality listed in `REBUILD_SPEC.md` sections 3 through 13.
- Build in phases exactly as described in section 12.
- Keep architecture modular with clear domain folders: `positions`, `candidates`, `interviews`, `skills`, `agent`.
- Write docs as you build: `ARCHITECTURE.md`, `API_CONTRACT.md`, `DATA_MODEL.md`, `ENVIRONMENT.md`, `RUNBOOK.md`, `QA_CHECKLIST.md`.
- Add tests for scoring logic and critical API flows.

Execution plan:
1. Scaffold repository and baseline tooling.
2. Implement data layer and DB schema.
3. Implement APIs with typed request/response contracts.
4. Implement frontend pages and room workflows.
5. Add integrations (OpenAI, LiveKit egress, agent control).
6. Add CI, deploy scripts, and docs.
7. Run lint/tests/build and provide a final verification report.

Definition of done:
- All acceptance criteria in `REBUILD_SPEC.md` section 13 are demonstrably satisfied.
- Commands to run locally from empty machine are documented and validated.
