# CaseCoach React frontend

The project now has one React/Vite application. Stephen's landing and hosted-login
entry design lives in `src/auth`; Ariel's patient library, avatars and conversation
UI live in `src/experience`. The encounter engine and its WebSocket contract from
PR #4 remain the source of live patient replies, captions, audio and sessions.
The unused `src/practice` application and its separate worklet were consolidated
into the active experience. Its caption, recovery, transcript and disclosure
behavior is covered by production-component tests in `src/experience`. There is
no separate static chat app or nested React installation.

## Local setup

Use Node 22.23 or later. From the repository root:

```sh
npm ci
npm run dev --workspace backend
npm run dev --workspace frontend
```

Open http://localhost:5173. The backend needs AWS configuration for Bedrock,
Transcribe, Polly, DynamoDB and S3, plus the Auth0 issuer and API audience. See
`backend/.env.example` and `backend/docs/aws-sessions.md`. Wyatt and Yvette's cases
are derived from the canonical profiles in `backend/data/profiles`; no manual
copying is needed. Disclosure-controlled facts stay on the server and are excluded
from the unconditional persona. `backend/cases/*.simulation.json` holds only
authored presentation, voice and response-style metadata.

For transport/UI development without AWS, start the backend with
`FAKE_AWS=1 npm run dev --workspace backend`. This uses scripted replies and memory
storage, not real AI/audio. Configure Auth0 on both ends to use signed-in live UI
with this fixture. Without Auth0 settings, the fake backend accepts only the
explicit development test identity on loopback, used by local test harnesses;
the browser's unauthenticated preview remains available. The standalone voice
sample uses a different protocol and is not the encounter backend.

Vite proxies `/ws` to localhost:3001. By default the browser uses `/ws` on the same
origin, including `wss` over HTTPS. A deployed host must proxy this WebSocket path.
An alternate endpoint can be supplied through `VITE_ENCOUNTER_WS_URL`.

## Landing, authentication and preview

Configure the public SPA domain/client ID in `public/auth-config.js`, or override
them through `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` in `frontend/.env`.
Set `VITE_AUTH0_AUDIENCE` to the Auth0 API identifier, matching `AUTH0_AUDIENCE`
on the backend.
See [AUTH0_SETUP.md](AUTH0_SETUP.md) for tenant configuration. The callback and
logout origins must include http://localhost:5173 during local development.

Student and faculty signup open Auth0-hosted pages. The signup selection is not
authorization; faculty permissions require trusted institutional verification.
Passwords, tokens and verification codes are not collected in React forms.

An explicitly unauthenticated educational preview remains available if Auth0 or
browser storage is unavailable. It uses the existing fixed communication replies
and cannot select Live AI. Browser speech recognition may use the browser vendor's
service; use only educational cases. Exiting preview/signing out cancels capture,
audio and callbacks before returning to the landing screen.

Live WebSocket connections authenticate with an initial access-token frame before
creating/resuming a session or accepting audio. The backend verifies the RS256
signature, issuer, audience and expiration and binds storage to the verified
subject. Another user cannot resume or modify your session. Tokens are never put
in WebSocket URLs or persisted by the encounter UI. Expired connections close;
reconnect obtains a fresh SDK token. Keep the origin allowlist configured and serve
the deployed app over HTTPS/WSS. Faculty access still requires a trusted role and
separate authorized review routes; choosing faculty signup grants no privilege.

The removed prototype's fictional patients, scripted clinical answers, browser
progress and static debriefs are not migrated or treated as live patient records.
Existing prototype localStorage values are ignored. Feedback/grading should be
integrated with backend-approved data rather than invented client-side results.

## Verification

```sh
npm test
npm run typecheck
npm run build --workspace frontend
```

Regression tests cover hosted signup/callbacks, access-token handshakes, preview
after storage failures, navigation/exit while recording, late dictation and replies,
caption review, reply timeouts and recovery without crossing patient boundaries.
The active UI also shows backend-disclosed facts and communication style. Auth0
tenant login and real microphone/AWS audio still require verification in the
configured environment.
