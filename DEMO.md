# Integrated product demo

`demo` includes every remote branch audited in `docs/demo-integration-audit.md`.
One React app connects to one authenticated encounter backend. The separate
`backend/voice` server is a reference prototype and is not started alongside it.

## Run now: scripted UI preview

From the repository root with the Node version in `.nvmrc`:

```sh
npm ci
npm run demo -- --preview
```

Open http://localhost:5173 and choose Preview. This explicit mode uses authored
responses and memory storage; it does not claim to exercise live AI or faculty
permissions. Stop the paired servers with Ctrl+C. Use `DEMO_PORT=5174` if needed.

## Run live AWS encounters and faculty review

### Local live demo with Auth0 disabled

For the current hackathon demo, start real AWS encounters without the unfinished
Auth0 setup:

```sh
npm run demo -- --local
```

The React app enters directly as a local demo student. Transcribe, Bedrock,
Polly, DynamoDB and S3 remain live. This mode binds only to loopback, rejects
non-loopback peers and refuses to run with `NODE_ENV=production`. All local
demo encounters use one demo identity; faculty routes stay forbidden. Stop
this process before starting the regular authenticated mode. This is for the
single-computer demo, not a deployment authentication system.

Check the running website and proxy using real AWS:

```sh
npm run demo:check --workspace backend -- --live
```

### Authenticated mode

The Rutgers event `healthhack` profile is working and the `casecoach-sessions`
CloudFormation stack is deployed in `us-west-2`. Resource names are configured in
ignored `backend/.env` and `backend/work/storage.env` on this machine. On a new
checkout, get the stack outputs with the AWS CLI and configure the table/bucket,
region and local credential profile from `backend/.env.example`. Do not commit
credentials. The bucket blocks public access, uses encryption and versioning.

The remaining tenant configuration is the exact Auth0 API **Identifier**:
Applications → APIs → CaseCoach API → Identifier. Sync it to both workspaces:

```sh
npm run configure:auth --workspace backend -- --audience 'YOUR_API_IDENTIFIER'
```

Use the signed `review:encounters` RBAC permission for institution-approved faculty,
or add an approved Auth0 user subject through `--faculty 'auth0|VERIFIED_USER_ID'`.
See `frontend/AUTH0_SETUP.md` for the exact dashboard setup and callback origins.
Passwords, tokens, signup choices and GitHub usernames do not authorize faculty.

Then run both services together:

```sh
npm run demo
```

This verifies matching audience settings before startup. It always binds the local
backend to loopback and starts the React app on the same configured demo port.
Signed-in students choose Wyatt, Yvette or a generated patient, speak, review/edit
final captions, and send the question. Responses include patient audio, transcript
and only backend-disclosed chart items. Reconnect restores the pinned encounter.
End the encounter and wait for archival acknowledgement; failures can retry.

Verified faculty see **Faculty review** in the sidebar. It lists all encounters
in this app, supports pagination, and opens completed transcript archives. Active
or archiving sessions remain unavailable until completion. Each request is
independently authorized; the browser never gets bucket credentials or S3 URLs.

The public MIMIC-IV demo is already imported locally. On another checkout:

```sh
npm run import:mimic-demo --workspace backend -- --limit 20
```

## Repeat verification

```sh
npm test
npm run typecheck
npm run build --workspace frontend
npm test --prefix backend/voice
npm run live:storage --workspace backend
npm run live:voice --workspace backend
npm run smoke --workspace backend
npm run live:system --workspace backend
npm run live:history --workspace backend
```

The root suite has 300 passing tests; the standalone voice prototype has nine.
Fourteen optional live AI evaluations are skipped. Live integration checks passed
for Wyatt, Yvette and generated patients through Transcribe, Bedrock Runtime,
Polly, reconnect/chart recovery, DynamoDB, versioned S3 and protected faculty HTTP
reads. The isolated live-system check signs short-lived test identities locally;
it does not change the app's Auth0 verifier or authorize production faculty.
Checks create educational sessions, which remain available for faculty review.

Hosted Auth0 login and a physical browser microphone/speaker test still require
the tenant API Identifier, faculty authorization and callback configuration. Code
and AWS service integration are complete; these final tenant/browser checks are
not represented as already verified.
