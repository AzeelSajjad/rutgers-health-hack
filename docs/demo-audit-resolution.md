# Demo audit and resolution plan

Reviewed commit: `1fa248d` on `demo`. Three subagents independently reviewed security, frontend behavior, and backend correctness. All eight findings below have now been addressed on `demo` with regression coverage. The original evidence and proposed resolution are retained for review.

## Applied resolution

- Generation requests now abort/invalidate on navigation, unmount and state changes; pending generation blocks competing starts and current session refs guard acceptance.
- Quotas are shared by verified subject across HTTP and sockets: one caption stream, six caption starts/minute, six generated patients/minute, 30 turns/minute and ten session starts/minute. Duplicate/draining starts are rejected and permits release once on terminal paths. These are process-local limits for this single-process demo, with an injection seam for a future distributed implementation.
- Transcribe distinguishes graceful input closure from cancellation and reports post-end AWS errors.
- Patient/validator policies permit released historical diagnoses; deterministic leakage checks distinguish hidden clinical content from authorized wording and record framing.
- Shared character/UTF-8 byte validation preserves oversized drafts, displays warnings and disables invalid sends.
- Preview audio now pauses/resumes, and playback cleanup prevents stale replies from resuming after navigation or patient changes.
- Dataset parsing is cached through a shared initialization promise, fingerprints detect source changes, decompression is asynchronous, failed initialization can retry, and generated cases are cloned with distinct IDs.
- `npm run demo -- --local` disables Auth0 for the localhost student demo while using real AWS. It is prohibited in production/non-loopback bindings and never grants faculty privileges.

## Post-fix verification

- Root suite: **300 passing tests** (178 backend Vitest, 38 backend Node, 84 frontend); 14 optional live evaluations skipped.
- Typecheck and frontend production build passed.
- Targeted live hospital-history check passed: released diagnosis accepted, patient reply validated without fallback, distinctive hidden diagnosis blocked.
- Live signed HTTP/WS system check passed for Wyatt, Yvette and a generated patient through Transcribe, Bedrock, Polly, reconnect/chart recovery, DynamoDB/S3 and protected faculty transcript access.
- Running localhost website/proxy verification passed with `npm run demo:check --workspace backend -- --live`: both default patients and a generated patient completed captions, replies, reconnect/transcript recovery and archival; unauthenticated access was rejected and local faculty access remained forbidden.
- Physical microphone capture and audible speaker playback remain manual verification; the Mac input meter was previously reported not to move. Auth0 hosted login is deliberately excluded from the current local demo.

## Findings

### 1. P1 — Late random-patient generation can abandon a newer encounter

Locations: `frontend/src/library/RandomPatientCard.tsx:10–13`, `frontend/src/experience/App.tsx:335–338` and `:385`.

The generation request retains a callback with old encounter state. If another encounter starts before the response returns, the callback can clear the new transcript, replace the patient, and force Live mode without confirming or ending the current encounter. A deferred-response UI reproduction confirmed this with a Preview encounter; the same captured-state path can abandon a live session.

Resolution: give generation an AbortController and request generation ID; invalidate responses on navigation, unmount, or encounter changes. Before accepting a generated patient, inspect current session/phase refs. Make generation and encounter-start actions mutually exclusive. Change patient and mode only after acceptance succeeds.

Acceptance: deferred generation cannot replace either an active Preview or live encounter; no transcript is cleared; no orphaned live session is created; current, accepted responses still select the generated patient.

### 2. P2 — Caption restart commands can create unbounded paid AWS requests

Location: `backend/src/ws/sessionHandler.ts:154–180`.

Every authenticated `caption_start` can launch another Transcribe stream after cancelling the prior stream. A fake-provider reproduction sent 100 starts in one session and counted 100 provider starts. Individual stream duration/byte caps do not limit restarts or multiple sockets for the same student. No credential theft is required: an authenticated student can exercise this path.

Resolution: reject duplicate starts while a stream is active; use a per-verified-subject admission controller across connections with a concurrent-stream limit and bounded start rate. Release stream permits exactly once after completion, error, cancellation, or socket close. Apply consistent request quotas to other costly authenticated operations when implementing the controller. Return an explicit retryable quota error. For multiple backend instances, use a shared quota mechanism rather than a process-local map alone.

Acceptance: repeated starts do not call the provider again; two sockets cannot bypass the subject quota; normal stop/restart works within the allowance; all failure/close paths release permits without double release.

### 3. P2 — Transcribe failures after Stop are reported as success

Location: `backend/src/speech/transcribe.ts:129–146`.

Graceful `end()` and hard cancellation both set `stopped`. An AWS failure arriving after graceful end therefore calls `onDone` instead of `onError`. An injected rejection after `end()` reproduced only a successful completion callback, hiding the cause of missing captions.

Resolution: separate input closure from intentional cancellation. Suppress only expected failures caused by an intentional abort; retain one terminal callback and preserve buffered final captions on successful graceful completion.

Acceptance: post-end AWS rejection reports an error exactly once; intentional cancellation retains its expected completion behavior; final buffered captions still arrive before successful completion.

### 4. P2 — Patient instructions contradict released historical diagnoses

Location: `backend/src/engine/patientPrompt.ts:23` and `:43`.

Generated cases authorize sharing selected hospital-record diagnoses, then unconditionally instruct the patient never to name a diagnosis. Constructing a real generated-case prompt confirmed both instructions are present. This can prevent the hospital-history feature from answering reliably.

Resolution: allow explicitly released historical diagnoses with record provenance. Continue prohibiting invented diagnoses, current diagnostic conclusions, hidden facts, and medical advice. Align patient instructions and validator policy.

Acceptance: a released recorded diagnosis can be discussed; an unreleased diagnosis or invented current diagnosis cannot. Include a focused live hospital-history evaluation after deterministic checks pass.

### 5. P2 — Shared diagnosis boilerplate triggers false leakage failures

Locations: `backend/src/engine/precheck.ts:17–18` and `:41–42`; `backend/src/imports/mimicDemo.ts:47`.

MIMIC diagnosis facts share authored boilerplate. Matching any four-word phrase against a locked fact therefore rejects wording from an explicitly disclosed fact. A reproduction using the exact authorized diagnosis fact returned leakage issues for two other hidden facts. This can cause unnecessary regeneration, fallback replies, and AWS cost.

Resolution: compare distinctive locked clinical content, excluding common authored boilerplate and wording already authorized by shareable facts. Keep separate detection for hidden diagnosis identifiers/names; do not broadly disable leakage protection.

Acceptance: an exact authorized record fact passes; distinctive hidden diagnosis wording fails; combining authorized boilerplate with a hidden diagnosis still fails.

### 6. P2 — Long dictated questions silently fail to send

Locations: `frontend/src/experience/App.tsx:218`, `:250`, `:287`, and `:395`.

Dictation can exceed 1,000 characters. Send remains enabled, but the handler silently returns without an error. A UI reproduction with 230 repetitions of “word ” confirmed the failure. The backend also enforces a 2,000-byte UTF-8 cap, which the frontend does not consistently validate.

Resolution: expose shared turn limits and validate typed/dictated text with the same character and UTF-8 byte rules. Show a counter and actionable warning, disable invalid submission, and preserve the complete text for editing rather than truncating it silently.

Acceptance: oversized captions show a warning and can be corrected; boundary-length questions send; multibyte text exceeding the byte limit is explained before submission; pending-turn protections remain intact.

### 7. P2 — Preview Pause stops playback without a way to resume

Locations: `frontend/src/experience/App.tsx:133–139` and `:393`.

Pause calls `speechSynthesis.cancel()`. Preview does not set `audioReady`, so Play becomes disabled afterward. A UI reproduction confirmed the advertised pause/resume interaction does not work.

Resolution: introduce explicit playback state and use speech synthesis pause/resume, or label the action Stop and provide replay of the current reply. Keep live HTMLAudio and Preview speech controls consistent; reset playback on patient switch, mute, navigation, and exit.

Acceptance: Preview and Live controls match their labels; paused audio can resume or stopped audio can replay; old patient audio never resumes after switching.

### Additional P2 performance finding — Random generation reparses the dataset per request

Locations: `backend/src/cases/catalogRoute.ts:14–21` and `backend/src/cases/caseRepository.ts:44–53`.

Every authenticated generation request reads, synchronously decompresses, and parses four source CSV files before rebuilding the eligible case pool. This repeated work is visible directly in the code; latency under load was not benchmarked in this review. Concurrent requests repeat the work and synchronous decompression can block other encounters on the Node event loop.

Resolution: lazily initialize and cache the immutable source pool with one shared initialization promise. Invalidate it only when the imported dataset changes; clone individual generated cases and keep the bounded generated-case map. Add per-subject generation rate limits alongside the resource controller in finding 2.

Acceptance: concurrent generation initializes the pool once; subsequent requests do not reread/decompress unchanged data; each generated patient still has a unique ID and correct provenance; failed initialization can be retried safely.

## Implementation sequence

1. Add regression tests for the generation race and provider restart quota; implement findings 1–2 first.
2. Repair Transcribe terminal-state handling and question limits (findings 3 and 6).
3. Update diagnosis prompt/validation together (findings 4–5), preserving hidden-fact tests.
4. Implement consistent playback controls (finding 7) and cached generation.
5. Run the full root suite, typecheck, frontend build, and standalone voice tests. Repeat targeted regressions and live voice/system checks after changes; verify physical microphone/playback manually once the Mac input works.
6. Commit and push the requested fixes directly to `demo`, retaining the acceptance evidence. No merge into `main` is part of this task.

## Verification completed

- Root suite: 277 passing tests (162 backend Vitest, 38 backend Node tests, 77 frontend); 14 optional live evaluations skipped.
- Typecheck and frontend production build pass.
- Standalone voice prototype: 9 tests pass.
- Full and production-only npm dependency audits: zero known vulnerabilities reported. This does not establish the absence of application vulnerabilities.
- Frontend reviewer ran three temporary UI reproductions outside the repository; all confirmed the identified behavior.
- Backend reviewer reproduced post-end error suppression and authorized-fact leakage rejection.
- Security reviewer reproduced 100 provider starts from 100 caption-start commands in one authenticated session.
- No confirmed JWT verification bypass, cross-student ownership bypass, faculty authorization bypass, or public transcript exposure was found in the reviewed paths.

## External blockers, separate from code defects

- Live app sign-in still needs the custom CaseCoach Auth0 API Identifier and tenant callback configuration. The Auth0 Management API audience is not the encounter API audience.
- The user's macOS input-level meter was reported not to move. Select/unmute a working audio input before physical browser capture can be verified. The code findings above do not establish the cause of that system-level symptom.
- Preview uses browser speech recognition and scripted dialogue; adaptive behavior requires the authenticated Live AI path. Physical browser microphone and speaker behavior has not been verified by this audit.
