# CaseCoach React frontend

The project now has one React/Vite application. Stephen's landing and hosted-login
entry design lives in `src/auth`; Ariel's patient library, avatars and conversation
UI live in `src/experience`. The encounter engine and its WebSocket contract from
PR #4 remain the source of live patient replies, captions, audio and sessions.
The original `src/practice` components and their tested transport helpers are
retained. There is no separate static chat app or nested React installation.

## Local setup

Use Node 22.23 or later. From the repository root:

```sh
npm ci
npm run dev --workspace backend
npm run dev --workspace frontend
```

Open http://localhost:5173. The backend needs its existing AWS configuration for
Bedrock, Transcribe and Polly. Wyatt and Yvette are registered in `backend/cases`,
so no manual copying is needed. Their disclosure-controlled facts stay on the
server and are excluded from the unconditional persona.

For transport/UI development without AWS, start the backend with
`FAKE_AWS=1 npm run dev --workspace backend`. This is a scripted backend fixture,
not a real AI/audio verification. The standalone voice module is a different
protocol and is not the encounter backend.

Vite proxies `/ws` to localhost:3001. By default the browser uses `/ws` on the same
origin, including `wss` over HTTPS. A deployed host must proxy this WebSocket path.
An alternate endpoint can be supplied through `VITE_ENCOUNTER_WS_URL`.

## Landing, authentication and preview

Configure the public SPA domain/client ID in `public/auth-config.js`, or override
them through `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` in `frontend/.env`.
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

The Auth0 SPA login protects entry to the signed-in UI only. The current encounter
WebSocket server still requires separate server-side authentication/authorization
integration before a public deployment. This PR does not claim to add that backend
security layer. Keep development on loopback with the existing origin allowlist.

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

Regression tests cover hosted signup/callbacks, preview after storage failures,
exit while recording, late dictation and replies across patient switches, caption
review, reply timeouts and failed-resume draft recovery. Auth0 tenant login and
real microphone/AWS audio still require verification in the configured environment.

Caption collection and patient-turn waiting use separate state and timeouts. The
composer is read-only until final captions finish; recovered questions remain
selectable after a failed resume. Prompt tests exercise the actual integrated
engine and cases, rather than a separate frontend installation or snapshots.
