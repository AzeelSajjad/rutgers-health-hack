import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import { SessionStorage, SessionAccessError, SessionConflictError, SessionInputError, type SessionActor } from '../app/sessions.js';
import { loadPatientProfile } from '../app/profiles.js';
const student: SessionActor = { subject: 'student-a', role: 'student' };
const faculty: SessionActor = { subject: 'faculty-a', role: 'faculty' };
const patientId = '4d619156-3250-4212-8399-129f3280fab1';
function record(status: 'active' | 'archiving' | 'completed' = 'active') {
  return { pk: 'SESSION#demo', sk: 'META', list_pk: 'SESSIONS', list_sk: 'now#demo', session_id: 'demo', patient_id: patientId, patient_version: 1, owner_sub: student.subject, status, revision: 0, turn_count: 1, created_at: 'now', updated_at: 'now', profile_snapshot: loadPatientProfile(patientId), disclosed_fact_ids: [] };
}
class StubClient {
  calls: { name: string; input: Record<string, unknown> }[] = [];
  constructor(private outputs: (Record<string, unknown> | Error)[]) {}
  async send(command: unknown): Promise<Record<string, unknown>> {
    const c = command as { constructor: { name: string }; input: Record<string, unknown> };
    this.calls.push({ name: c.constructor.name, input: c.input });
    const next = this.outputs.shift();
    if (!next) throw new Error(`Unexpected ${c.constructor.name}`);
    if (next instanceof Error) throw next;
    return next;
  }
}
function storage(dynamo: StubClient, s3 = new StubClient([])) {
  return new SessionStorage({ tableName: 'demo-table', bucketName: 'demo-bucket', dynamo: dynamo as unknown as Pick<DynamoDBDocumentClient, 'send'>, s3: s3 as unknown as Pick<S3Client, 'send'> });
}
function turns() { return [{ pk: 'SESSION#demo', sk: 'TURN#00000001', turn_id: 'turn-1', sequence: 1, role: 'patient', text: 'Opening', created_at: 'now', disclosed_fact_ids: [] }]; }
test('students cannot read another student session or faculty archives/listings', async () => {
  const db = new StubClient([{ Item: record() }]), store = storage(db);
  await assert.rejects(store.getSession({ subject: 'student-b', role: 'student' }, 'demo'), SessionAccessError);
  await assert.rejects(store.listFacultySessions(student), SessionAccessError);
  await assert.rejects(store.getFacultyTranscript(student, 'demo'), SessionAccessError);
  assert.equal(db.calls.length, 1);
});
test('public metadata excludes pinned case and hidden disclosures', async () => {
  const db = new StubClient([{ Item: record() }]), response = await storage(db).getSession(faculty, 'demo');
  assert.equal(response.session_id, 'demo');
  for (const key of ['profile_snapshot', 'disclosed_fact_ids', 'pk', 'archive_key']) assert.ok(!Object.hasOwn(response, key));
});
test('creation pins the profile and logs opening in the same transaction', async () => {
  const db = new StubClient([{}]);
  const result = await storage(db).createSession(student, patientId);
  assert.equal(result.turn_count, 1);
  assert.equal(db.calls[0].name, 'TransactWriteCommand');
  const writes = db.calls[0].input.TransactItems as { Put: { Item: Record<string, unknown> } }[];
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].Put.Item.profile_snapshot, loadPatientProfile(patientId));
  assert.equal(writes[1].Put.Item.text, loadPatientProfile(patientId).opening_statement);
});
test('trusted exchanges atomically log both turns with revision and owner conditions', async () => {
  const db = new StubClient([{ Item: record() }, {}]);
  const result = await storage(db).appendExchange(student, 'demo', { expectedRevision: 0, studentText: 'Bowel concerns?', patientText: 'Constipation.', disclosedFactIds: ['constipation'] });
  assert.equal(result.revision, 1); assert.equal(result.turn_count, 3);
  const writes = db.calls[1].input.TransactItems as { Update?: { ConditionExpression: string }; Put?: { Item: Record<string, unknown> } }[];
  assert.equal(writes.length, 3);
  assert.match(writes[0].Update!.ConditionExpression, /revision = :expected/);
  assert.match(writes[0].Update!.ConditionExpression, /owner_sub = :owner/);
  assert.equal(writes[1].Put!.Item.role, 'student');
  assert.equal(writes[2].Put!.Item.role, 'patient');
});
test('closed, stale, invalid disclosure and oversized exchanges never write', async () => {
  for (const [row, exchange, error] of [
    [record('completed'), { expectedRevision: 0, studentText: 'Hi', patientText: 'Hi' }, SessionConflictError],
    [record(), { expectedRevision: 1, studentText: 'Hi', patientText: 'Hi' }, SessionConflictError],
    [record(), { expectedRevision: 0, studentText: 'Hi', patientText: 'Hi', disclosedFactIds: ['invented'] }, SessionInputError],
    [record(), { expectedRevision: 0, studentText: 'x'.repeat(8001), patientText: 'Hi' }, SessionInputError],
  ] as const) {
    const db = new StubClient([{ Item: row }]);
    await assert.rejects(storage(db).appendExchange(student, 'demo', exchange), error);
    assert.equal(db.calls.length, 1);
  }
});
test('paginated messages strip storage keys and preserve next cursor', async () => {
  const db = new StubClient([{ Item: record() }, { Items: turns(), LastEvaluatedKey: { pk: 'SESSION#demo', sk: 'TURN#00000001' } }]);
  const page = await storage(db).getMessages(faculty, 'demo', 0, 1);
  assert.equal(page.nextAfterSequence, 1);
  assert.ok(!Object.hasOwn(page.messages[0], 'pk'));
  assert.equal(db.calls[1].input.ConsistentRead, true);
});
test('archive upload failure leaves archiving retryable; completion follows upload', async () => {
  const active = record(), archiving = record('archiving');
  const db = new StubClient([{ Item: active }, { Attributes: archiving }, { Item: archiving }, { Items: turns() }]);
  const s3 = new StubClient([new Error('upload unavailable')]);
  await assert.rejects(storage(db, s3).finishSession(student, 'demo'), /upload unavailable/);
  assert.equal(db.calls.filter(c => c.name === 'UpdateCommand').length, 1);
  const retryDb = new StubClient([{ Item: archiving }, { Item: archiving }, { Items: turns() }, { Attributes: { ...archiving, status: 'completed' } }]);
  const retryS3 = new StubClient([{ VersionId: 'version-1' }]);
  const result = await storage(retryDb, retryS3).finishSession(student, 'demo');
  assert.equal(result.status, 'completed');
  assert.equal(retryS3.calls[0].input.ServerSideEncryption, 'AES256');
  assert.equal(retryS3.calls[0].input.Key, 'sessions/demo/transcript.json');
  const archive = JSON.parse(retryS3.calls[0].input.Body as string);
  assert.equal(archive.messages.length, 1);
  assert.deepEqual(archive.profile, loadPatientProfile(patientId));
});
test('missing turns prevent an incomplete S3 archive', async () => {
  const archiving = { ...record('archiving'), turn_count: 3 };
  const db = new StubClient([{ Item: archiving }, { Item: archiving }, { Items: turns() }]), s3 = new StubClient([]);
  await assert.rejects(storage(db, s3).finishSession(student, 'demo'), SessionConflictError);
  assert.equal(s3.calls.length, 0);
});
test('faculty reads a specific archive version and verifies checksum', async () => {
  const body = JSON.stringify({ messages: [{ text: 'Demo' }] });
  const row = { ...record('completed'), archive_key: 'sessions/demo/transcript.json', archive_version: 'v1', archive_sha256: createHash('sha256').update(body).digest('hex') };
  const db = new StubClient([{ Item: row }]), s3 = new StubClient([{ Body: { transformToString: async () => body } }]);
  assert.equal(await storage(db, s3).getFacultyTranscript(faculty, 'demo'), body);
  assert.equal(s3.calls[0].input.VersionId, 'v1');
  const badDb = new StubClient([{ Item: row }]), badS3 = new StubClient([{ Body: { transformToString: async () => 'changed' } }]);
  await assert.rejects(storage(badDb, badS3).getFacultyTranscript(faculty, 'demo'), /checksum mismatch/);
});
test('small infrastructure keeps storage private and IAM limited', () => {
  const template = JSON.parse(readFileSync(new URL('../infrastructure/sessions-stack.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(template.Resources).length, 4);
  const bucket = template.Resources.TranscriptBucket.Properties;
  assert.ok(Object.values(bucket.PublicAccessBlockConfiguration).every(v => v === true));
  assert.equal(bucket.OwnershipControls.Rules[0].ObjectOwnership, 'BucketOwnerEnforced');
  assert.equal(bucket.VersioningConfiguration.Status, 'Enabled');
  assert.equal(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
  const statements = template.Resources.BackendStoragePolicy.Properties.PolicyDocument.Statement;
  assert.ok(!JSON.stringify(statements).includes('Delete'));
  assert.equal(statements[1].Resource['Fn::Sub'], '${TranscriptBucket.Arn}/sessions/*');
  assert.equal(template.Resources.SessionsTable.Properties.BillingMode, 'PAY_PER_REQUEST');
});

test('message cursor at the end returns an empty page without an invalid range query', async () => {
  const db = new StubClient([{ Item: record() }]);
  assert.deepEqual(await storage(db).getMessages(student, 'demo', 1001), { messages: [], nextAfterSequence: null });
  assert.equal(db.calls.length, 1);
});
