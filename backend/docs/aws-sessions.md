# AWS encounter storage and faculty review

This feature logs simulated educational encounters (the brief's “clinical
trials/encounters”). It does not run a research trial or generate clinical feedback.
It provides the storage and review foundation for those application features.

Branch: `feature/dynamodb-s3-sessions`, based on the profile/chart feature commit.
No AWS account has been deployed or verified yet. Account, region, artifact bucket,
and the existing sign-in provider's issuer/audience/scope are still required.

## Architecture and access

API Gateway HTTP API validates access-token signature, issuer, audience, expiration,
and the configured API scope. Only its validated JWT `sub` reaches the Lambda
identity boundary. An existing RSA-based OIDC provider is required by this template;
if the existing sign-in uses a different token format, adapt the authorizer before
deployment. We do not replace your sign-in system or create a Cognito pool.

DynamoDB `ACCESS` records establish active app membership. An administrator provisions
verified sign-in subjects with role `student` or `faculty`. No public endpoint can
set a role or enroll users. The Lambda IAM role cannot write `USER#...` membership
keys. Student requests are restricted to sessions with their own `owner_sub`.
Faculty can review every encounter in this app, as requested. Their role is checked
server-side on every request; body/header/token role fields are ignored.

S3 objects are private. All four public-access blocks are enabled, ACLs are disabled,
HTTPS is required, uploads use AES256 encryption, and bucket versioning is enabled.
The Lambda role can read/write only the `sessions/` prefix of this app's bucket,
with no delete permission. Faculty receive a version-specific 60-second download
URL only after authorization. That URL is a temporary bearer capability: keep it
out of logs and shared messages; revoking membership prevents future issuance but
an already-issued URL can still work for the remainder of its short lifetime.

DynamoDB uses on-demand billing, encryption at rest, point-in-time recovery, and
delete protection. The table and transcript bucket are retained if the stack is
deleted or replaced. No automatic transcript expiry or TTL is configured; choose
a retention/deletion policy with the team before wider use. App audit records are
retained alongside sessions. Operational CloudWatch logs expire after 30 days and
record request ids/status/error codes, not chat text, JWTs, notes, or signed URLs.
The exact frontend HTTPS origin is configured for CORS; CORS is not authorization.

## Storage contract

One table, partition/sort keys `pk` and `sk`:

| Record | Partition | Sort key | Content |
| --- | --- | --- | --- |
| Membership | `USER#sha256(sub)` | `ACCESS` | Role, active flag |
| Session | `SESSION#uuid` | `META` | Owner, pinned profile JSON, state, revision, disclosures, archive pointer |
| Turn | `SESSION#uuid` | `TURN#00000001` | Stable turn id, sequence, role, text, timestamp, disclosure ids |
| Retry receipt | `SESSION#uuid` | `REQUEST#sha256(request_id)` | Payload hash and saved result |
| Review | `SESSION#uuid` | `REVIEW#timestamp#uuid` | Faculty subject, decision, notes |
| Access audit | `SESSION#uuid` or `APP_AUDIT` | `AUDIT#timestamp#uuid` | Actor, action, timestamp |

`SessionList` indexes session metadata using `list_pk=APP_SESSIONS` and timestamp/id
`list_sk`; it projects only listing fields, not the full hidden profile. Listings
are eventually consistent. Individual metadata and transcript reads are strongly
consistent. Each conversation turn is its own item rather than an ever-growing
DynamoDB transcript. Messages are limited to 8000 UTF-8 bytes; a session supports
1001 turns (one patient opening plus 500 two-turn exchanges). Transcript/review/list reads are paginated.

At creation the current profile is copied into an immutable session snapshot.
Profile edits after creation cannot change that session's facts or objectives.
The patient opening is logged atomically with session creation as `turn-1`.
Session revision starts at zero and increments once for each logged student/patient exchange.

## Integration with the encounter backend

`app/sessions.py` provides `SessionStore`. Call `record_exchange` from trusted
backend logic after the patient reply and disclosed facts have been validated:

```python
result = session_store.record_exchange(
    subject=validated_student_sub,
    session_id=session_id,
    request_id=request_id,
    expected_revision=current_revision,
    student_text=question,
    patient_text=validated_reply,
    disclosed_fact_ids=newly_disclosed_fact_ids,
)
# result: session_id, new revision, and two stable turn_ids
```

These turns, the session metadata update, and the retry receipt are one DynamoDB
transaction with revision/active/owner conditions. A matching retry returns the
original result without duplicate turns; reusing a request id with changed content
or a stale revision returns a conflict. Preserve the validated reply on retries.
`record_exchange` does not call Bedrock, determine disclosure, or validate the
medical meaning of generated wording. Its patient-text parameter must never be
populated from a browser request. There is deliberately no public chat-write route
in this storage API. Wire this method into your teammate's actual message handler.
Do not maintain a second independent session id/revision store in that handler.

Use `pinned_profile(subject, session_id)` server-side and pass it to
`build_chart_response(profile, session_disclosed_fact_ids)` for consistent charts.
Full snapshots and raw source rows must not be sent to student clients. The storage
API's public metadata excludes them. The encounter engine already has authorization
checks available in the store, but must handle question processing and feedback.

`finish` freezes an active session into `archiving`, blocking further turns. It reads
and checks all ordered turns, uploads `sessions/{uuid}/transcript.json`, then stores
the S3 version id/checksum and marks the session `completed`. DynamoDB and S3 do not
share a transaction: failure leaves `archiving` retryable with the original turns
intact. Retry the finish call; never report completion before the archive succeeds.
Concurrent finishing may produce unreferenced S3 versions, while metadata points
to exactly one successful version. No destructive cleanup is automated.

The archive includes messages, pinned profile, and disclosure state. Faculty
reviews append separate records and cannot rewrite the original transcript.
`reviewed` and `follow_up_requested` are decisions, not automated clinical grades.
Students cannot view private faculty notes. If feedback is generated later, persist
it separately and refer to these stable turn ids; that is not implemented here.

## HTTP contract

Every route requires `Authorization: Bearer <access token>` and the configured
scope. All JSON responses have `Cache-Control: no-store`.

| Route | Who | Request/result |
| --- | --- | --- |
| `POST /sessions` | Student | `{ "patient_id": "UUID" }` → session metadata |
| `GET /sessions/{session_id}` | Owner or faculty | Session metadata |
| `GET /sessions/{session_id}/messages` | Owner or faculty | `after_sequence=0&limit=50` → ordered messages and `next_after_sequence` |
| `POST /sessions/{session_id}/finish` | Student owner | Empty body → completed metadata; retry storage failures |
| `GET /faculty/sessions` | Faculty | `limit=25&before=cursor` → sessions and `next_before` |
| `GET /faculty/sessions/{session_id}/archive` | Faculty | Completed session → version-specific download URL, expiry, SHA256 |
| `POST /faculty/sessions/{session_id}/reviews` | Faculty | `{ "decision": "follow_up_requested", "notes": "..." }` → review |
| `GET /faculty/sessions/{session_id}/reviews` | Faculty | `limit=25&after=cursor` → reviews and `next_after` |

Session metadata: `session_id`, `patient_id`, `patient_version`, `owner_sub`, `status`,
`revision`, `turn_count`, `created_at`, `updated_at`, `review_status`.
Status is `active`, `archiving`, or `completed`. `review_status` starts `pending`.
Turn fields: `turn_id`, `sequence`, `role` (`student`/`patient`), `text`, `created_at`,
`disclosed_fact_ids`. A null pagination cursor means there is no next page.
Error responses contain `error`: 400 invalid data, 403 unauthorized membership/owner,
404 missing resource/route, 409 stale/closed state, 503 AWS storage failure.

## Local verification

From `backend/`:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python infrastructure/build_template.py
.venv/bin/cfn-lint infrastructure/sessions-stack.json
.venv/bin/python scripts/package_sessions.py
```

Moto tests exercise DynamoDB transactions, independent sessions, access boundaries,
revocation, retry behavior, pagination, S3 version/encryption metadata, recovery after
upload failure, and faculty review without changing archived transcripts. Static
checks verify infrastructure settings. These checks do not prove deployed IAM,
JWT verification, real S3 policy enforcement, or live AWS behavior.

## AWS deployment

1. Use an authorized AWS SSO/profile session for the intended account and region.
   Obtain the existing provider's exact JWT issuer, API audience, and access-token
   scope from the teammate who owns sign-in. Confirm RSA OIDC compatibility. Do not
   paste credentials, passwords, or bearer tokens into this repository or chat.
2. Select an existing private artifact bucket in the same region. The deploy helper
   checks all public-access blocks and the caller's account before uploading a ZIP.
   Use an artifact bucket that accepts the helper's AES256 uploads.
3. Copy `infrastructure/deployment.example.json` to the ignored
   `infrastructure/deployment.local.json` and replace every placeholder. Use a short
   stack name (40 characters or fewer).
4. Prepare a change set with the AWS SDK, or apply it using `--execute`:

```sh
.venv/bin/python scripts/deploy_sessions.py --config infrastructure/deployment.local.json
.venv/bin/python scripts/deploy_sessions.py --config infrastructure/deployment.local.json --execute
```

The second command creates a new change set and executes it; it does not reuse the
first change set. Alternatively inspect and execute the first in AWS CloudFormation.
The helper packages only `app/*.py` and profile JSON; Python 3.12 Lambda supplies
Boto3. It excludes local configuration, virtual environments, tests, and secrets.
The stack outputs API URL, table name, and transcript bucket name. AWS access to
create/update the stack and its IAM role is required. This creates billable resources.

5. An administrator enrolls verified JWT subjects using their AWS profile:

```sh
.venv/bin/python scripts/provision_membership.py --profile YOUR_PROFILE --region YOUR_REGION --expected-account YOUR_ACCOUNT --table OUTPUT_TABLE --subject VERIFIED_SUB --role student
.venv/bin/python scripts/provision_membership.py --profile YOUR_PROFILE --region YOUR_REGION --expected-account YOUR_ACCOUNT --table OUTPUT_TABLE --subject VERIFIED_FACULTY_SUB --role faculty
```

Use the same command with `--revoke` to disable membership. The deploy/runtime
identity is not a substitute for faculty membership; faculty sign in through the app.
Verify faculty subjects before granting app-wide access. Only privileged admin AWS
identities should have permission to edit membership records.

6. Before claiming a working deployment, test with two real student access tokens
   and one faculty token: create/log/finish an encounter, deny the other student,
   list/review/download as faculty, deny a revoked faculty member, deny an expired or
   wrong-audience token, and confirm anonymous S3 access fails. Check transcripts,
   disclosures, and faculty audit entries. Never share those tokens or signed URLs.

## Requirement mapping and AWS references

The challenge calls for encounter logs, disclosure records, consistent patient
state, and evidence-based feedback. This feature supplies durable ordered logs,
stable turn ids, pinned case versions, disclosure ids, and faculty follow-up records.
It does not replace your teammates' encounter, voice, or feedback engines.

- [API Gateway JWT validation and access-token scopes](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [S3 block public access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [S3 object ownership and ACLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html)
- [DynamoDB atomic transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
- [S3 signed URLs and their bearer-token behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
