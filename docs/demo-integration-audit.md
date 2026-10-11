# Demo integration audit

Refreshed GitHub branch heads on October 10, 2026. Every listed branch head is an
ancestor of `demo`, verified with `git rev-list demo..origin/<branch>` and
`git merge-base --is-ancestor`. GitHub's branch Ahead/Behind numbers compare with
`main`, not with `demo`. Open PRs into main do not mean their commits are absent
from demo.

| Branch | Audited head | Commits missing from demo |
| --- | --- | --- |
| `casecoach-ui` | `ae50d42` | 0 |
| `codex/latest-main` | `2a31405` | 0 |
| `dillon/mimic-patients` | `2b42594` | 0 |
| `dillon/speech` | `b041aa9` | 0 |
| `feature/ai-avatar-experience` | `b9a8136` | 0 |
| `feature/default-patient-profiles` | `23fdc69` | 0 |
| `feature/dynamodb-s3-sessions` | `8de3707` | 0 |
| `feature/encounter-engine` | `2e5190e` | 0 |
| `main` | `6320714` | 0 |

## Merge history and conflict resolution

- `8620112`: main + the corrected MIMIC/avatar branch.
- `fec8668`: the combined branch + `codex/latest-main`. Conflicts occurred in
  the case repository, encounter engine, session store, server entry, React
  experience, frontend README and the deleted Yvette JSON case. They were resolved
  by retaining the unified Auth0 entry, canonical default profiles, generated
  case support, authenticated server and durable storage adapter. Caption state
  and timers were reconciled with navigation/reconnect/archival state.
- `970c1ac`: latest PR #8 test correction. Its conflict in RandomPatientCard's test
  was resolved retaining both visible-name matching and the access-token assertion.
- The other branch heads were already included via main and the merge ancestry;
  merging them again would report already up to date.

## Components connected in the active application

- `frontend/src/main.tsx` -> AuthApp -> the React avatar experience.
- AuthApp obtains a token; the avatar authenticates the `/ws` connection before
  starting/resuming encounters. Random patient HTTP selection uses a bearer token.
- The server routes requests through one case repository. Defaults derive from
  the faculty CSV profiles; imported/random patients use the MIMIC demo cases.
- The encounter handler feeds PCM audio to Transcribe, runs the analyzer/patient/
  validator engine, and sends Polly audio and disclosed facts to the same UI.
- Real mode uses DynamoSessionStore -> SessionStorage -> DynamoDB and S3; fixture
  mode explicitly substitutes scripted speech/LLM services and memory storage.

The audit caught a cross-component defect: durable creation assumed every patient
had a faculty profile file. Generated MIMIC patients therefore failed in real
storage despite passing the memory demo. The fix pins a validated generated case
as an explicitly generated profile snapshot with its original provenance, rather
than looking it up as a faculty case. Defaults keep their canonical profile snapshots.

## Verification and limits

- Root suite: 262 tests pass (159 backend Vitest, 38 backend Node, 65 frontend).
  Fourteen live AI evaluations are skipped.
- The standalone voice prototype's separate nine tests pass.
- TypeScript checks and the React production build pass.
- Running Vite/backend smoke test: authenticated selection, PCM captions, patient
  replies, reconnect/transcript restoration and ending for both defaults and a
  generated patient; anonymous HTTP/WebSocket requests are denied.
- The added generated-patient integration test uses the actual WebSocket server,
  frontend frame validator, engine and durable adapter. It verifies selection,
  captions, exchange persistence, recovery after catalog removal, cross-user
  denial, S3 archival and an authorized faculty archive read. External AI/audio
  and AWS command transports are mocked; no real AWS session is created.

`backend/voice` is a standalone prototype included in Git history. The active UI
uses the authenticated encounter backend's speech adapters, not that prototype's
`/api/transcribe` and `/api/speech` endpoints. Its passing tests do not establish
that its own endpoints are wired into the app.

Faculty storage policies/read methods exist, but the application still needs
faculty review screens/routes and trusted role mapping. Sign-up selection alone
never grants faculty permissions. Auth0 tenant login and real Bedrock/Transcribe/
Polly/DynamoDB/S3 calls are not verified by these local tests. Local AWS/storage
and backend Auth0 environment settings are not configured. Full live end-to-end
verification requires that configuration.
