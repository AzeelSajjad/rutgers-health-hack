# Simple AWS session storage for the demo

One DynamoDB table stores session metadata and ordered chat messages. One private
S3 bucket stores completed JSON transcripts. The existing backend owns sign-in,
conversation logic, chart disclosure, and faculty access. There is no separate
API Gateway, Lambda, Cognito, or application membership database in this feature.

## Run locally

From `backend/`, with Node.js 22+:

```sh
npm ci
npm run typecheck
npm test
npm run aws:check
```

The last command uses credentials exported in that terminal. For a saved local
profile: `AWS_PROFILE=healthhack npm run aws:check`. Credentials belong outside the
repository; workshop credentials expire and must be refreshed. AWS CLI installation
is a one-time step. The Node SDK and CLI can use the same local profile.

## Create the resources

Copy `infrastructure/deployment.example.json` to
`infrastructure/deployment.local.json` (ignored). Verify the account, region, and
profile match your workshop login. No issuer, audience, artifact bucket, or frontend
URL is needed for this storage-only stack.

```sh
npm run aws:deploy
```

This validates the AWS account and template and prepares a CloudFormation change
set. Inspect it in the AWS console. Execute that change set there, or run
`npm run aws:deploy -- --execute` to create and execute a new change set.
A stack left in `REVIEW_IN_PROGRESS` by preparation still uses a CREATE change
set and the create-completion waiter when rerun with `--execute`. An already
deployed stack uses UPDATE. Preparation alone creates no table or bucket.

The deployment creates billable resources and needs permission to create DynamoDB,
S3, and a managed IAM policy. If the workshop denies an action, use the organizer's
approved execution role; do not make the bucket public to work around permissions.

Outputs are `SessionTableName`, `TranscriptBucketName`, and
`BackendStoragePolicyArn`. Attach that policy to the **existing backend's execution
role**. The script does not choose or modify a teammate's role. When deployed through
the script, `work/storage.env` contains the table/bucket/region names, not credentials.
The table and bucket are retained if the stack is deleted; clean up explicitly after
the demo, subject to workshop access. This stack has no automatic expiration policy.

## Live encounter integration

The WebSocket encounter engine now uses this same table and transcript archive
through `DynamoSessionStore` and `SessionStorage`. Load the resource names emitted
by deployment before starting the backend from the repository root:

```sh
set -a
. backend/work/storage.env
set +a
npm run start --workspace backend
```

`SESSION_TABLE_NAME` and `TRANSCRIPT_BUCKET_NAME` are required when `FAKE_AWS`
is disabled. Missing configuration fails startup instead of silently storing
sessions in memory. The old `SESSIONS_TABLE` name is accepted with a warning;
conflicting old/new names fail. `FAKE_AWS=1` explicitly uses local scripted fakes
and an in-memory session store without any storage credentials or resources.

The authenticated connection supplies the owner; browser input cannot choose it.
Configure `AUTH0_ISSUER_BASE_URL` (or `AUTH0_DOMAIN`) and `AUTH0_AUDIENCE` on the
backend, with the same API identifier as frontend `VITE_AUTH0_AUDIENCE`. The server
verifies the access token before session commands or audio, and scopes reads,
writes, pinned-case access and archive retries to its subject. Expiration closes
the connection. Missing authentication configuration fails closed. The explicit
fake-AWS test identity is limited to loopback binding/peers and disabled when
`NODE_ENV=production`; it is not a deployed authentication option.

Creating a live encounter pins both the canonical profile and its engine case in
`META`. A validated exchange atomically updates the engine snapshot, metadata, and
two ordered `TURN#` records using owner, revision, and active-status conditions.
Live encounters begin with zero transcript messages because the engine does not
emit the profile's separate opening statement. Metadata and faculty message/archive
helpers read the same records. `appendExchange` rejects live-engine records: writes
must go through the validated encounter engine, keeping its snapshot in sync.

Ending a live encounter freezes its record as `archiving`, uploads the complete
transcript to encrypted, versioned S3, then marks it `completed`. Failed uploads
leave it frozen and retryable. Repeating end or reconnecting retries the pending
archive; it never accepts new messages while archiving. Existing encounters use
their pinned engine case even if the canonical profile changes later. The engine
snapshot, pinned cases, and storage keys are server-only data.

## Additional trusted backend helpers

```typescript
import { SessionStorage, buildChartResponse, type SessionActor } from './app/index.js';

const storage = new SessionStorage({
  tableName: process.env.SESSION_TABLE_NAME!,
  bucketName: process.env.TRANSCRIPT_BUCKET_NAME!,
  region: process.env.AWS_REGION,
});
// Your existing authentication middleware supplies both fields.
const actor: SessionActor = { subject: verifiedUser.id, role: verifiedUser.role };
const session = await storage.createSession(actor, patientUuid);
const saved = await storage.appendExchange(actor, session.session_id, {
  expectedRevision: session.revision,
  studentText: question,
  patientText: validatedPatientReply,
  disclosedFactIds: validatedNewDisclosures,
});
const state = await storage.getEncounterState(actor, session.session_id);
const chart = buildChartResponse(state.profile, state.disclosedFactIds);
await storage.finishSession(actor, session.session_id);
```

`SessionActor` is a trusted backend value. **Never construct it from request body,
query parameters, unverified JWT claims, or a role selected in the frontend.**
Your teammate's existing sign-in middleware must authenticate the request and look
up its current role. Students access their own encounters; faculty may read all
encounters in this app. If the current sign-in does not establish a trusted faculty
role, faculty routes cannot be enabled until that role is established.

The existing backend can wire these functions into its own routes:

| Helper | Intended use |
| --- | --- |
| `createSession(actor, patientId)` | Create encounter and log patient opening |
| `getSession(actor, sessionId)` | Public metadata for owner/faculty |
| `appendExchange(actor, sessionId, exchange)` | Trusted encounter handler logs student/patient pair |
| `getMessages(actor, sessionId, afterSequence, limit)` | Owner/faculty reads ordered messages; follow `nextAfterSequence` |
| `getEncounterState(actor, sessionId)` | Server-only pinned profile and disclosed fact ids |
| `finishSession(actor, sessionId)` | Owner freezes and archives the transcript |
| `listFacultySessions(actor, cursor)` | Faculty lists encounters; follow `nextCursor` |
| `getFacultyTranscript(actor, sessionId)` | Faculty backend reads completed JSON from private S3 |

Do not expose `getEncounterState` as a student response: it contains hidden case
facts. Do not accept patient replies or disclosure ids directly from the browser.
Return only chart projections and public metadata to students. Serve transcript
responses through the faculty-authorized backend with `Cache-Control: no-store`.
Do not log chat text, auth tokens, or transcript contents. No S3 URL or AWS credential
is sent to the frontend. The live WebSocket lifecycle is integrated. Additional
HTTP faculty routes remain the backend's responsibility and must enforce a verified
faculty role.

## Data and failure behavior

A session UUID is the shared key: `pk=SESSION#uuid`, `sk=META` for metadata and
`sk=TURN#00000001` etc. for messages. Faculty listings use the `SessionList` index;
it projects only public metadata and is eventually consistent. Session/message
reads are strongly consistent. The case is pinned at creation so later profile
changes cannot alter an encounter. Each student/patient pair and metadata update
are one transaction, guarded by revision and active status. Messages are limited to
8000 UTF-8 bytes each and 1001 turns per encounter.

A stale revision or DynamoDB conditional/transaction conflict means the caller
should reload state. After a network timeout, reload and inspect saved turns before
retrying; this small demo adapter does not include durable request-id deduplication.
Map conditional conflicts to HTTP 409, access errors to 403, invalid input to 400,
and AWS service failures to a redacted 503 in your existing backend.

Finishing changes `active` to `archiving`, preventing new messages. It verifies the
complete ordered transcript, writes encrypted JSON to S3, and only then sets
`completed`. An upload failure leaves the session retryable through `finishSession`.
S3 and DynamoDB do not share a transaction. Concurrent finish attempts can conflict
or leave extra S3 versions; metadata selects one archive version. A completed finish
is safe to repeat. Faculty reads verify that version's SHA256 checksum.

S3 blocks public access, disables ACLs, requires HTTPS, encrypts objects, and keeps
versions. DynamoDB uses on-demand capacity and encryption. Backend permissions are
limited to the created table/index and S3 `sessions/` objects, with no delete access.
The live WebSocket server authenticates and checks ownership. Additional faculty
HTTP routes are not exposed here: they must verify a trusted faculty role before
calling these helpers. The storage adapter cannot verify an arbitrary
`SessionActor` by itself.

## Demo explanation

“We store the conversation as ordered messages in DynamoDB. When a student finishes,
we archive that session in a private S3 bucket. The existing login controls access:
students see their own encounters, and faculty can review encounters across the app.
We preserve the patient profile used for that session so the transcript stays
consistent even if the default profile is updated later.”

Describe this as an educational simulation demo. It does not establish production
readiness or healthcare compliance. Before broader use, add a reviewed retention
policy, backups, access auditing, monitoring, stronger retry handling, and live
security testing. Faculty feedback/grading and saved review notes are future work.
Use simulated sample cases for the demo.

## Verification status

The local `healthhack` profile authenticated successfully in `us-west-2`, and AWS
CloudFormation accepted the small template. The resources have not been deployed.

Local tests cover access boundaries, hidden-state exclusion, message transactions,
archive failure/retry, ordered transcript checks, and private storage configuration.
They do not prove live IAM or the configured Auth0 tenant. Before demoing,
verify in AWS with two student identities and one faculty identity: deny cross-student
access, complete a session, read its archive as faculty, deny student archive access,
and confirm anonymous S3 access fails. No live deployment is claimed until tested.
