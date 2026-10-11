# CaseCoach voice module

The integrated product runs from the repository root with `npm run demo`. Its
authenticated encounter backend owns captions, patient audio and sessions. This
folder is a standalone reference/test prototype; do not run it on port 3001
alongside the product backend. The React app uses the encounter `/ws` protocol.

Local prototype: microphone -> Amazon Transcribe captions; patient reply text -> Amazon Polly MP3. Patient AI and avatar rendering belong to the other team modules.

## Run

Node 22+ required. In the Terminal with Workshop Studio Mac/Linux AWS credential exports:

```sh
cd backend/voice
npm ci
export AWS_REGION=us-west-2
npm start
```

Open http://localhost:3001. Allow microphone access, speak, then stop and wait for final captions. Test the patient reply separately. AWS credentials stay on the backend. If credentials expire, paste fresh exports and restart it.

Required event role actions: `transcribe:StartStreamTranscription`, `polly:SynthesizeSpeech`. No S3 bucket needed. Uses Joanna neural English (US).

## React integration

Copy `public/voice-client.js` into React's source and import `startTranscription` and `getPatientAudio`. The backend serves the AudioWorklet. Default React origin: http://localhost:5173. For another port set `FRONTEND_ORIGIN=http://localhost:3000` before starting the backend.

```js
const recording = await startTranscription({
  baseUrl: 'http://localhost:3001',
  onTranscript: ({id, text, isPartial}) => {
    // Replace live captions for partial events.
    // Upsert final segments by id; do not append every partial.
    // Review final text before sending it to the patient AI.
  },
  onError: message => console.error(message),
  onStatus: status => console.log(status),
});
recording.stop(); // waits for final AWS results
// On unmount: recording.cancel()

const blob = await getPatientAudio(patientReplyText);
const url = URL.createObjectURL(blob);
audioElement.src = url;
await audioElement.play();
// Revoke URL after replacing/finishing audio: URL.revokeObjectURL(url).
```

Pause playback before recording to avoid transcribing the patient. Provide a Play button for browsers that block automatic playback. The avatar can use this audio element's play/ended events.

## API

- `GET /health`: local health only, does not verify AWS access.
- `POST /api/speech`: JSON `{ "text": "Patient reply" }`; returns `audio/mpeg`. Text: 1–3000 characters. Failures: JSON `{ "error": "..." }`.
- `WS /api/transcribe`: send `{ "type": "start", "sampleRate": 16000 }`, then binary mono signed 16-bit little-endian PCM, followed by `{ "type": "stop" }`. Keep the socket open for final results. Events: `{ "type": "transcript", "id": "...", "text": "...", "isPartial": true|false }`, `done`, or `error` with `message`. The worklet uses 100 ms chunks and sends the actual AudioContext sample rate.

Loopback-only local prototype with allowed browser origins; no user authentication. Review before public deployment. Audio and transcripts are not persisted. Streams end after five minutes. Use synthetic cases.

## Verification

`npm test` runs nine checks covering audio queue draining, disconnect wakeups, buffering limits, PCM encoding and chunking, malformed WebSocket controls, split UTF-8 HTTP input, the request size limit, and a complete recording stream with mocked AWS clients. Live AWS microphone and audio must be checked on the test page with event credentials.
