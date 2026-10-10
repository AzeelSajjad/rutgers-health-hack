# Patient avatar experience

Branch: `feature/ai-avatar-experience`, from `main`. A standalone React/TypeScript
conversation screen, independent of PR #2's implementation and module structure.
PR #2's source-faithfulness guidelines inform the sample experience: keep the two
patient UUIDs, do not invent missing clinical facts, preserve distinct personalities,
and label authored simulation choices. Existing profile files inherited from main
are untouched; the new UI does not import them or their helpers.

## Run

From `frontend/avatar-experience`:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Choose Wyatt or Yvette from the practice case cards.
The reference-inspired learning-space shell includes overview and practice navigation,
sage styling, and a collapsible sidebar. The patient menu remains available inside
an encounter. Browsing cases preserves the current encounter until you switch patients.
**Preview** is clearly labeled and uses fixed communication-only replies, optional browser
speech recognition, and device speech synthesis. It is not AI, is not graded, and
does not upload transcripts to AWS. Microphone preview depends on browser support;
typing is always available. Hidden clinical facts stay in the server case files; the
preview does not simulate clinical disclosure. Browser speech recognition may use a browser vendor's
service; use only these educational sample cases.

The avatars are authored SVG illustrations, not source portraits or reconstructions
of appearance from clinical/demographic data. Patient data determines the case and
conversation behavior; the visual depiction is an illustrative simulation choice.
Motion follows audio playback state; it is not phoneme-accurate lip synchronization.

## Live AI integration

The screen implements the WebSocket contract inspected on the teammate's
`feature/encounter-engine` branch. It does not copy or replace that backend.
The standalone `backend/voice` test server is a different protocol and cannot serve
this screen's live encounter by itself.

1. Run the encounter team's backend with valid AWS model/Transcribe/Polly access.
2. Install the two independently authored JSON cases from `backend/experience-cases`
   into that backend's `backend/cases/` folder, retaining each UUID filename.
3. Allow `http://localhost:5173` in the backend's `ALLOWED_ORIGINS`.
4. Copy `.env.example` to `.env` and set `VITE_ENCOUNTER_WS_URL` if the engine is not
   at `ws://localhost:3001/ws`. Restart Vite after changing the environment.
5. Choose **Live AI**, then begin. The server must return the selected patient name
   and age. A mismatched case blocks the encounter instead of relabeling its replies.

The two case files follow the encounter engine's case format, not PR #2's profile
format. They contain the supplied clinical facts plus explicitly authored persona
instructions, voices, response styles, and disclosure choices. No negative medical
findings are invented. They must remain server-only; no complete clinical facts or
teaching rules are shipped in the live browser presentation catalog.

| UI action | Backend contract |
| --- | --- |
| Begin | `start_session` with original patient UUID as `caseId` |
| Reconnect | `resume_session` with server-issued `sessionId` |
| Speak | `caption_start`, binary mono 16 kHz PCM, `caption_stop` after final flush |
| Review speech | Replace partial captions; accumulate final captions in editable draft |
| Send reviewed question | `student_turn` with text; no patient replies supplied by browser |
| Reply | `patient_turn`: commit returned turns and play `audioBase64` MP3 |
| End | `end_session`; wait for confirmed `session_ended` |

Transcript turns use backend indexes for ordering and deduplication. Disconnects
stop microphone/audio and preserve the pending question; reconnect resumes the
server transcript before permitting another send. A response timeout also forces a
reconnect to avoid blindly duplicating a possibly committed question. Backpressure
stops capture; denied/unsupported microphone access preserves typed input. Auto-play
failure leaves a Play button; muted or missing audio still shows the patient text.
The microphone does not run during patient playback. Changing patients ends the
current live encounter first; mode changes are disabled during an active session.
End-session confirmation and dialogs support keyboard focus trapping and Escape.

The encounter backend owns authentication, AI validation/disclosures, audio
services, persistence, and grading. This branch does not create AWS resources or
claim that a local UI connection is authenticated. Use loopback for the hackathon
until your existing sign-in and deployment are integrated. Backend session ending
must not be described as an S3 upload until the storage integration is completed.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests check protocol validation, replayed transcript ordering, both patient/case
mappings, preserved behavior, and missing clinical information. Browser checks
cover patient switching, caption review/typed replies, mode changes, end-session
confirmation, errors, and mobile layout. A scripted transport check verifies the
live contract independently of AWS. Real microphone permissions, live AI response
quality, and Transcribe/Polly audio must also be tested with the actual backend.
