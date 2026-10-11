/** Demo storage adapter. Call only from an authenticated, trusted backend. */
import { randomUUID, createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { loadPatientProfile, type PatientProfile } from './profiles.js';

/** Build this from verified sign-in state, never a request body or unverified JWT. */
export interface SessionActor { subject: string; role: 'student' | 'faculty' }
export interface SessionMetadata {
  session_id: string;
  patient_id: string;
  patient_version: number;
  owner_sub: string;
  status: 'active' | 'archiving' | 'completed';
  revision: number;
  turn_count: number;
  created_at: string;
  updated_at: string;
}
interface SessionRecord extends SessionMetadata {
  pk: string; sk: 'META';
  list_pk: 'SESSIONS'; list_sk: string;
  profile_snapshot: PatientProfile;
  disclosed_fact_ids: string[];
  archive_key?: string;
  archive_version?: string;
  archive_sha256?: string;
}
export interface ChatMessage {
  turn_id: string; sequence: number; role: 'student' | 'patient'; text: string;
  created_at: string; disclosed_fact_ids: string[];
}
export class SessionAccessError extends Error {}
export class SessionConflictError extends Error {}
export class SessionInputError extends Error {}
function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SessionInputError(message);
}
function checkActor(actor: SessionActor): void {
  if (!actor || typeof actor.subject !== 'string' || !actor.subject.trim() || !['student', 'faculty'].includes(actor.role)) throw new SessionAccessError('Verified app identity is required');
}
function publicMetadata(record: SessionRecord): SessionMetadata {
  const { session_id, patient_id, patient_version, owner_sub, status, revision, turn_count, created_at, updated_at } = record;
  return { session_id, patient_id, patient_version, owner_sub, status, revision, turn_count, created_at, updated_at };
}
function turnKey(sequence: number): string { return `TURN#${String(sequence).padStart(8, '0')}`; }
function checkText(text: string): void {
  requireInput(typeof text === 'string' && text.trim().length > 0 && Buffer.byteLength(text, 'utf8') <= 8000, 'Messages must contain 1–8000 UTF-8 bytes');
}
export interface SessionStorageOptions {
  tableName: string; bucketName: string;
  dynamo?: Pick<DynamoDBDocumentClient, 'send'>;
  s3?: Pick<S3Client, 'send'>;
  region?: string;
}
export class SessionStorage {
  private readonly dynamo: Pick<DynamoDBDocumentClient, 'send'>;
  private readonly s3: Pick<S3Client, 'send'>;
  constructor(private readonly options: SessionStorageOptions) {
    requireInput(Boolean(options.tableName && options.bucketName), 'Table and bucket names are required');
    this.dynamo = options.dynamo ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region: options.region }));
    this.s3 = options.s3 ?? new S3Client({ region: options.region });
  }
  private async record(actor: SessionActor, sessionId: string, ownerOnly = false): Promise<SessionRecord> {
    checkActor(actor);
    requireInput(typeof sessionId === 'string' && sessionId.length > 0, 'Session id is required');
    const response = await this.dynamo.send(new GetCommand({ TableName: this.options.tableName, Key: { pk: `SESSION#${sessionId}`, sk: 'META' }, ConsistentRead: true }));
    const record = response.Item as SessionRecord | undefined;
    // Same response for missing and inaccessible sessions.
    if (!record || (ownerOnly ? actor.role !== 'student' || record.owner_sub !== actor.subject : actor.role !== 'faculty' && record.owner_sub !== actor.subject)) throw new SessionAccessError('Session is unavailable');
    return record;
  }
  async createSession(actor: SessionActor, patientId: string): Promise<SessionMetadata> {
    checkActor(actor);
    if (actor.role !== 'student') throw new SessionAccessError('Only students create encounters');
    const profile = loadPatientProfile(patientId);
    const sessionId = randomUUID(), now = new Date().toISOString(), pk = `SESSION#${sessionId}`;
    const record: SessionRecord = { pk, sk: 'META', list_pk: 'SESSIONS', list_sk: `${now}#${sessionId}`, session_id: sessionId, patient_id: profile.id, patient_version: profile.version, owner_sub: actor.subject, status: 'active', revision: 0, turn_count: 1, created_at: now, updated_at: now, profile_snapshot: profile, disclosed_fact_ids: [] };
    const opening: ChatMessage = { turn_id: 'turn-1', sequence: 1, role: 'patient', text: profile.opening_statement, created_at: now, disclosed_fact_ids: [] };
    await this.dynamo.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.options.tableName, Item: record, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.options.tableName, Item: { pk, sk: turnKey(1), ...opening }, ConditionExpression: 'attribute_not_exists(pk)' } },
    ] }));
    return publicMetadata(record);
  }
  async getSession(actor: SessionActor, sessionId: string): Promise<SessionMetadata> { return publicMetadata(await this.record(actor, sessionId)); }
  /** Server-only: use this pinned case for conversation and chart projection. */
  async getEncounterState(actor: SessionActor, sessionId: string): Promise<{ profile: PatientProfile; disclosedFactIds: string[]; revision: number }> {
    const record = await this.record(actor, sessionId);
    return { profile: record.profile_snapshot, disclosedFactIds: record.disclosed_fact_ids, revision: record.revision };
  }
  /** Trusted encounter handler supplies validated patient text and disclosures. */
  async appendExchange(actor: SessionActor, sessionId: string, exchange: { expectedRevision: number; studentText: string; patientText: string; disclosedFactIds?: readonly string[] }): Promise<SessionMetadata> {
    const record = await this.record(actor, sessionId, true);
    requireInput(Number.isInteger(exchange.expectedRevision) && exchange.expectedRevision >= 0, 'Expected revision must be a nonnegative integer');
    checkText(exchange.studentText); checkText(exchange.patientText);
    const released = exchange.disclosedFactIds ?? [];
    const known = new Set(record.profile_snapshot.facts.map(fact => fact.id));
    requireInput(Array.isArray(released) && released.every(id => typeof id === 'string' && known.has(id)), 'Unknown disclosed fact');
    if (record.status !== 'active' || record.revision !== exchange.expectedRevision || record.turn_count >= 1001) throw new SessionConflictError('Encounter is closed, full, or changed; reload its state');
    const now = new Date().toISOString();
    const messages: ChatMessage[] = [
      { turn_id: `turn-${record.turn_count + 1}`, sequence: record.turn_count + 1, role: 'student', text: exchange.studentText, created_at: now, disclosed_fact_ids: [] },
      { turn_id: `turn-${record.turn_count + 2}`, sequence: record.turn_count + 2, role: 'patient', text: exchange.patientText, created_at: now, disclosed_fact_ids: [...new Set(released)] },
    ];
    const disclosures = [...new Set([...record.disclosed_fact_ids, ...released])];
    await this.dynamo.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: this.options.tableName, Key: { pk: record.pk, sk: 'META' }, UpdateExpression: 'SET revision = :next, turn_count = :count, updated_at = :now, disclosed_fact_ids = :facts', ConditionExpression: '#status = :active AND revision = :expected AND owner_sub = :owner', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':next': record.revision + 1, ':count': record.turn_count + 2, ':now': now, ':facts': disclosures, ':active': 'active', ':expected': record.revision, ':owner': actor.subject } } },
      ...messages.map(message => ({ Put: { TableName: this.options.tableName, Item: { pk: record.pk, sk: turnKey(message.sequence), ...message }, ConditionExpression: 'attribute_not_exists(pk)' } })),
    ] }));
    return publicMetadata({ ...record, revision: record.revision + 1, turn_count: record.turn_count + 2, updated_at: now });
  }
  async getMessages(actor: SessionActor, sessionId: string, afterSequence = 0, limit = 50): Promise<{ messages: ChatMessage[]; nextAfterSequence: number | null }> {
    const record = await this.record(actor, sessionId);
    requireInput(Number.isInteger(afterSequence) && afterSequence >= 0 && afterSequence <= 1001, 'Invalid message cursor');
    requireInput(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Limit must be 1–100');
    if (afterSequence >= record.turn_count) return { messages: [], nextAfterSequence: null };
    const response = await this.dynamo.send(new QueryCommand({ TableName: this.options.tableName, KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end', ExpressionAttributeValues: { ':pk': record.pk, ':start': turnKey(afterSequence + 1), ':end': turnKey(1001) }, ConsistentRead: true, Limit: limit }));
    const messages = (response.Items ?? []).map(item => {
      const { pk, sk, ...message } = item;
      return message as ChatMessage;
    });
    return { messages, nextAfterSequence: response.LastEvaluatedKey && messages.length ? messages.at(-1)!.sequence : null };
  }
  async finishSession(actor: SessionActor, sessionId: string): Promise<SessionMetadata> {
    let record = await this.record(actor, sessionId, true);
    if (record.status === 'completed') return publicMetadata(record);
    if (record.status === 'active') {
      const response = await this.dynamo.send(new UpdateCommand({ TableName: this.options.tableName, Key: { pk: record.pk, sk: 'META' }, UpdateExpression: 'SET #status = :archiving', ConditionExpression: '#status = :active AND revision = :revision AND owner_sub = :owner', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':archiving': 'archiving', ':active': 'active', ':revision': record.revision, ':owner': actor.subject }, ReturnValues: 'ALL_NEW' }));
      record = response.Attributes as SessionRecord;
    }
    const messages: ChatMessage[] = [];
    let cursor: number | null = 0;
    do {
      const page = await this.getMessages(actor, sessionId, cursor, 100);
      messages.push(...page.messages); cursor = page.nextAfterSequence;
    } while (cursor !== null);
    if (messages.length !== record.turn_count || messages.some((message, i) => message.sequence !== i + 1)) throw new SessionConflictError('Transcript is incomplete; encounter remains archiving');
    const body = JSON.stringify({ schema_version: 1, session: publicMetadata({ ...record, status: 'completed' }), profile: record.profile_snapshot, disclosed_fact_ids: record.disclosed_fact_ids, messages });
    const key = `sessions/${sessionId}/transcript.json`;
    const archive = await this.s3.send(new PutObjectCommand({ Bucket: this.options.bucketName, Key: key, Body: body, ContentType: 'application/json', ServerSideEncryption: 'AES256' }));
    if (!archive.VersionId) throw new SessionConflictError('Archive bucket must have versioning enabled');
    const response = await this.dynamo.send(new UpdateCommand({ TableName: this.options.tableName, Key: { pk: record.pk, sk: 'META' }, UpdateExpression: 'SET #status = :completed, archive_key = :key, archive_version = :version, archive_sha256 = :hash, updated_at = :now', ConditionExpression: '#status = :archiving AND owner_sub = :owner', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':completed': 'completed', ':archiving': 'archiving', ':owner': actor.subject, ':key': key, ':version': archive.VersionId, ':hash': createHash('sha256').update(body).digest('hex'), ':now': new Date().toISOString() }, ReturnValues: 'ALL_NEW' }));
    return publicMetadata(response.Attributes as SessionRecord);
  }
  /** Faculty-only listing; return the opaque cursor unchanged to fetch next page. */
  async listFacultySessions(actor: SessionActor, cursor?: Record<string, unknown>): Promise<{ sessions: SessionMetadata[]; nextCursor: Record<string, unknown> | null }> {
    checkActor(actor);
    if (actor.role !== 'faculty') throw new SessionAccessError('Faculty access required');
    const response = await this.dynamo.send(new QueryCommand({ TableName: this.options.tableName, IndexName: 'SessionList', KeyConditionExpression: 'list_pk = :pk', ExpressionAttributeValues: { ':pk': 'SESSIONS' }, ScanIndexForward: false, Limit: 25, ExclusiveStartKey: cursor }));
    return { sessions: (response.Items ?? []).map(item => publicMetadata(item as SessionRecord)), nextCursor: response.LastEvaluatedKey ?? null };
  }
  /** Return through a faculty-authorized backend route; never expose bucket access. */
  async getFacultyTranscript(actor: SessionActor, sessionId: string): Promise<string> {
    checkActor(actor);
    if (actor.role !== 'faculty') throw new SessionAccessError('Faculty access required');
    const record = await this.record(actor, sessionId);
    if (record.status !== 'completed' || !record.archive_key || !record.archive_version) throw new SessionConflictError('Transcript is not archived yet');
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.options.bucketName, Key: record.archive_key, VersionId: record.archive_version }));
    if (!result.Body) throw new Error('Archive body is missing');
    const body = await result.Body.transformToString();
    if (createHash('sha256').update(body).digest('hex') !== record.archive_sha256) throw new Error('Archive checksum mismatch');
    return body;
  }
}
