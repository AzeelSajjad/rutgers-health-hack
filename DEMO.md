# Product demo branch

`demo` combines main, the corrected avatar branch (PR #6), the corrected random
MIMIC patient branch (PR #8), and the authentication/storage integration branch.
The remaining remote feature branches are included through main's merge history.

## Start the product

Use the Node version in `.nvmrc`. From the repository root:

```sh
git switch demo
npm ci
npm run dev --workspace backend
npm run dev --workspace frontend
```

Open http://localhost:5173. Configure the backend from `backend/.env.example`
and the frontend from `frontend/.env.example`; match the Auth0 issuer/API audience
on both ends. Use the hackathon's temporary AWS credentials, region, deployed
DynamoDB table and private S3 bucket as described in `backend/docs/aws-sessions.md`.
See `frontend/AUTH0_SETUP.md` for hosted sign-in setup.

To enable the optional random patients, download and verify the public demo data:

```sh
npm run import:mimic-demo --workspace backend -- --limit 20
```

The imported files stay local under `backend/work` and are not committed. Default
Wyatt/Yvette encounters do not need the import. Signed-in users can generate a
random patient and start the same avatar conversation. Generation requires an
access token; active encounters retain their case snapshot if the selection cache
evicts it. Hidden case details are excluded from the patient selection response.

## Demo walkthrough

1. Open the landing page and sign in as a student.
2. Select Wyatt or Yvette, or generate a random patient after the import.
3. Begin the live conversation. Speak, stop recording, review/edit the captions,
   then send the question. Typed questions work as well.
4. Follow the transcript and facts disclosed by the backend. Reconnect restores
   the encounter; unsent questions are retained with their original patient.
5. End the encounter and wait for backend confirmation that archival completed.
   If storage fails, retry ending; the UI does not accept more questions meanwhile.

Unauthenticated preview is available for a scripted UI demonstration. For local
transport tests, `FAKE_AWS=1 npm run dev --workspace backend` uses scripted AWS
fixtures and memory storage. Configure Auth0 on both ends for signed-in browser
use; the explicit development token is accepted only by a loopback test harness.

## Verified on this branch

`npm test`: 262 passing tests, with 14 live AI evaluations skipped.
`npm run typecheck` and `npm run build --workspace frontend` pass.
Tests cover Auth0 token validation, cross-user session denial, private archival,
archive retries, caption review/recovery, default case disclosure and generated
case retention. Live Auth0 tenant login and AWS voice/storage calls still require
the configured hackathon environment. The storage faculty policy requires trusted
roles; a faculty signup selection alone does not grant access, and faculty review
screens/routes still need integration.


## Repeat the local smoke test

Start the scripted backend and frontend in separate terminals:

```sh
FAKE_AWS=1 ALLOWED_ORIGINS=http://127.0.0.1:5174 npm run dev --workspace backend
npm run dev --workspace frontend -- --host 127.0.0.1 --port 5174 --strictPort
```

After importing the public MIMIC demo once, run:

```sh
DEMO_ORIGIN=http://127.0.0.1:5174 npm run demo:check --workspace backend
```

The check uses Vite's actual HTTP/WebSocket proxy and the frontend frame validator.
It verifies unauthorized rejection, safe patient selection responses, caption
completion, exchanges, reconnect/transcript recovery, and ending for Wyatt,
Yvette and one generated patient. It is restricted to loopback and uses the
explicit development identity; it does not change the browser sign-in flow.
The UI's unauthenticated preview can be opened manually at the same address.

For branch ancestry, merge conflicts, component wiring and test limits, see
[the integration audit](docs/demo-integration-audit.md).
