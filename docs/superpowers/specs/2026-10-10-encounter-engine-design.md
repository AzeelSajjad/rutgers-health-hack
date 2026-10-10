# Encounter Engine, Voice Loop and Adaptive Patient: Design

**Status:** Revised after plan review · **Date:** 2026-10-10 · **Branch:** `feature/encounter-engine`

## Purpose

A student talks to a simulated patient. The patient answers only from faculty-approved facts, reveals facts according to each fact's disclosure rule, and changes how it talks (its response style) when the student uses approved interaction cues. Clinical facts never change. Every reply is checked before Amazon Polly speaks it.

This is the encounter engine and voice loop from the CaseCoach pitch deck (slides 6–8). Case authoring (Patient Studio), the medical-record panel and end-of-session feedback are out of scope. They consume this engine's data later.

## Interaction model (deck slide 7: "First target")

Voice is **turn-based**, with captions and a text fallback:

1. The student presses **Start speaking**. After the mic is granted, mic audio streams over a WebSocket to the backend, which forwards it to Amazon Transcribe streaming. Live captions stream back.
2. The student presses **Stop** (or **Send** directly), reviews or edits the caption text, and sends it. On Send, the client waits up to 1 s for the final caption, so the last words aren't cut off. Typing instead of speaking works the same way.
3. The backend runs one encounter turn and returns the patient's validated reply text, the Polly mp3, the current style, and the facts disclosed so far.

Real-time full-duplex speech-to-speech and barge-in are out of scope for v1.

## Case data

A case (`PatientCase`) has:
- Patient identity: name, age, sex, visit reason, persona, Polly `voiceId`.
- `facts[]`: each fact has `{ id, topic, content, disclosure }`.
  - `atStart`: known to the student from the start (e.g. the visit reason).
  - `onRequest`: unlocked when the student asks about the topic.
  - `whenExplored`: unlocked only when the student digs into the topic. The analyzer must say the topic was explored, **and** either the topic was asked about in an earlier turn or the current turn follows up on something the patient said.
  - `topic` is a short label that **must not reveal the content** (e.g. "how regularly she takes her medicine", not "missed doses").
- `pertinentNegatives[]`: things the patient does **not** have (e.g. "No chest pain"). The patient answers plainly "no" to these, so the review of systems sounds realistic.
- `learningObjectives[]`.
- `styles[]` (`{ id, label, description, mayMinimize }`), `initialStyleId`, `transitions[]` (`{ from, cue, to }`).
  - `mayMinimize: true` lets the patient play problems down in that style ("most days", "not too bad") but never flatly deny a fact. This is how faculty make some patients more reserved than others.

v1 loads cases from JSON files in `backend/cases/`. The sample case is the deck's "Morgan Lee" synthetic case, and it reproduces the deck's slide 6/8 exchange.

## Turn pipeline (per student turn)

```
student text
  ├─ 1. analyzeTurn (Haiku 5.5, structured output)
  │     → requestedFactIds, exploredFactIds, cues   (filtered locally against known ids and cues)
  ├─ 2. applyDisclosure (pure)   → whenExplored gate + at most 2 new facts per turn
  ├─ 3. nextStyle (pure)         → styleId   (applies to THIS reply)
  ├─ 4. generate reply (Sonnet 5.5)
  │     prompt contains ONLY disclosed facts, pertinent negatives, and topics of locked facts
  ├─ 5a. precheck (pure): wording copied from a locked fact, numbers not in approved facts
  ├─ 5b. validate (Sonnet 5.5, structured output) ‖ Polly synthesis starts speculatively in parallel
  │     fail → regenerate once with the problems listed → fail again → in-character fallback line
  ├─ 6. audio (Polly failure → text-only reply)
  └─ 7. persist both turns (the student turn includes the full analysis) + state (DynamoDB)
```

Safety properties:
- Locked fact content is never in the patient prompt, so the patient can't leak it.
- The deterministic precheck catches the cheapest failures without an LLM round trip.
- The validator sees the patient identity, recent conversation, pertinent negatives and the style's `mayMinimize`, which reduces false positives. It rejects: invented clinical details, flat denials or contradictions, diagnoses or advice, breaking character, following instructions embedded in the student's words, listing locked topics, and stage directions.
- The disclosure cap and the whenExplored gate limit how much a prompt-injection attack on the analyzer can unlock.

## Adaptive style

Cues come from a fixed set: `acknowledged_concern`, `open_ended_question`, `follow_up_on_patient_statement`, `used_medical_jargon`, `dismissive_or_rushed`. The analyzer detects them in each student turn. `nextStyle` applies the first matching transition from the current style. At most one style change happens per turn. Style changes only tone, openness and (through `mayMinimize`) willingness to downplay, never facts.

## Models

Claude on Amazon Bedrock through `AnthropicBedrockMantle` (`@anthropic-ai/bedrock-sdk`), with a 20 s timeout and 1 retry.

| Role | Default model ID | Env var |
|---|---|---|
| Analyzer | `anthropic.claude-haiku-5-5` | `ANALYZER_MODEL_ID` |
| Patient | `anthropic.claude-sonnet-5-5` | `PATIENT_MODEL_ID` |
| Validator | `anthropic.claude-sonnet-5-5` | `VALIDATOR_MODEL_ID` |

All calls use `output_config: { effort: "low" }` and adaptive thinking (the `thinking` parameter is omitted). Structured outputs use `messages.parse` + `zodOutputFormat`. Enum constraints are **not** enforced by the Bedrock schema conversion, so enum-like fields are declared as strings and filtered in code.

## Persistence

`EncounterState` (`sessionId`, `caseId`, `status`, `styleId`, `disclosedFactIds`, `turns[]`, `createdAt`) is stored as one DynamoDB item, partition key `sessionId` (S), in the table named by `SESSIONS_TABLE`. If that variable is unset, an in-memory store is used. Sessions are capped at 60 student turns.

## WebSocket protocol (`/ws`)

Client → server: `start_session {caseId}`, `resume_session {sessionId}`, `caption_start`, binary PCM frames (16 kHz, mono, Int16 little-endian), `caption_stop`, `student_turn {text}`, `end_session`.
Server → client: `session_started {…, transcript, resumed}`, `caption {text, isFinal}`, `caption_done`, `patient_thinking`, `patient_turn {studentTurn, patientTurn, audioBase64, styleId, styleLabel, disclosedFacts}`, `session_ended`, `error {message, code?}`.

- One turn at a time per connection.
- The client keeps the `sessionId` in `sessionStorage` and reconnects with backoff, resuming the session. If resume fails, the server sends `error` with code `RESUME_FAILED`, and the client starts a new session.
- The server pings every 25 s, accepts only allowed Origins, and limits frames to 64 KB.

## Development without AWS

`FAKE_AWS=1` swaps in scripted fakes: a keyword analyzer, a patient that echoes the newest disclosed fact, a validator that always passes, no audio, and fake captions. The frontend can then be built and demoed without Bedrock.

## Non-goals (v1)

Streaming partial replies, barge-in, talking avatar, case authoring UI, feedback grader, learning across sessions, Transcribe Medical, authentication.
