# Integration fixes and verification

Implemented on `codex/latest-main` after merged PR #7 (`6320714`), using three
development subagents and regression tests written before the fixes.

## Changes

- Active encounters use the deployed DynamoDB composite keys and canonical
  deployment environment names. Missing real storage settings fail startup.
- The existing storage implementation now persists engine state and ordered
  messages atomically with ownership/revision guards, pins the patient profile and
  engine case, and archives completed transcripts to private, versioned S3.
- Failed archival freezes the encounter and can retry on end or reconnect. The
  UI keeps question input/microphone disabled and offers an explicit retry.
- Live WebSockets require an initial verified Auth0 access token. Signature,
  issuer, audience and expiry are checked; the verified subject owns the session.
  Anonymous audio/messages and cross-user recovery are denied. Tokens never enter
  WebSocket URLs. Development fixtures are restricted to loopback and are disabled
  in production without real authentication.
- Navigation cancels active/pending microphone capture. Recovery drafts stay with
  their patient; transient reconnect failures cannot enable question submission.
- Removed the dormant second frontend encounter implementation and worklet,
  migrating relevant regression coverage into the active UI. Backend-disclosed
  facts and communication style are visible again.
- Clinical facts, identity and objectives derive from canonical faculty profiles;
  simulation metadata cannot override them. Removed the redundant backend lockfile.
- Signup validates field types and bounds before trimming. Upgraded the development
  tools to versions with no reported dependency vulnerabilities.

## Verification

- Fresh root `npm ci` succeeds on Node 22.23.1.
- `npm test`: 238 passing tests (149 backend Vitest, 38 backend Node, 51 frontend);
  14 live AI evaluations remain skipped.
- `npm run typecheck`: passes for both workspaces.
- `npm run build --workspace frontend`: passes using Vite 8.3.4.
- Full `npm audit`: zero known vulnerabilities, including development dependencies.
- Browser checks passed for signup/callback, token-first actual WebSocket traffic,
  exchanges/end for both patients, reconnect transcript recovery, microphone tracks
  ending on navigation, preview recognition cleanup, sign out, mobile layout and
  storage-failure fallback. Auth0 was simulated, microphone input used Chrome's
  fake device, and the backend used scripted AWS fixtures.
- Storage integration tests exercise the real engine and owner-scoped adapter with
  an in-process AWS command transport, including archive failure/recovery and
  faculty version/checksum reads. No live AWS resources were changed.

## Environment verification remaining

Real Auth0 tenant login/signup/MFA, live AWS IAM/services and deployed HTTPS/WSS
proxy behavior have not been tested. Set the issuer and matching API audience on
both ends, plus the deployed table and bucket names, as described in
`frontend/AUTH0_SETUP.md` and `backend/docs/aws-sessions.md`. Faculty review routes
still require trusted role integration; the signup button grants no faculty role.
