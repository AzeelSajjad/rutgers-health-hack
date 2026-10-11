import { describe, expect, it } from "vitest";
import type { EncounterState } from "@casecoach/shared";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import { DynamoSessionStore } from "../src/sessions/sessionStore.js";
import { SessionStorage } from "../app/sessions.js";
import { loadPatientProfile } from "../app/profiles.js";
import { makeCase } from "./fixtures.js";
import { endEncounter, getActiveEncounter, runTurn, startEncounter, type EngineDeps } from '../src/engine/encounter.js';
import { FakeLlm } from './fakes/fakeLlm.js';
import { FakeTts } from './fakes/fakeTts.js';
import { sessionsForOwner } from '../src/security/auth.js';
import { FileCaseRepository } from '../src/cases/caseRepository.js';
import { fileURLToPath } from 'node:url';

// Real adapter calls with in-process AWS command transport; never calls AWS.
class Database {
  rows = new Map<string, Record<string, any>>();
  writes: any[] = [];
  key(row: any) { return `${row.pk}/${row.sk}`; }
  async send(command: any): Promise<any> {
    const input = command.input;
    if (command.constructor.name === "GetCommand") return { Item: structuredClone(this.rows.get(this.key(input.Key))) };
    if (command.constructor.name === "QueryCommand") {
      if (input.IndexName === 'SessionList') return { Items: [...this.rows.values()].filter(row => row.sk === 'META') };
      return { Items: [...this.rows.values()].filter(row => row.pk === input.ExpressionAttributeValues[":pk"] && row.sk.startsWith("TURN#")).sort((a, b) => a.sk.localeCompare(b.sk)) };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      const puts = input.TransactItems.map((item: any) => item.Put);
      for (const put of puts) {
        const previous = this.rows.get(this.key(put.Item));
        if (put.ConditionExpression.includes("attribute_not_exists") && previous) throw new Error("conflict");
        if (put.ExpressionAttributeValues && (!previous || previous.revision !== put.ExpressionAttributeValues[":expected"] || previous.owner_sub !== put.ExpressionAttributeValues[":owner"] || previous.status !== "active")) throw new Error("conflict");
      }
      for (const put of puts) this.rows.set(this.key(put.Item), structuredClone(put.Item));
      this.writes.push(input);
      return {};
    }
    if (command.constructor.name === "UpdateCommand") {
      const previous = this.rows.get(this.key(input.Key))!;
      const values = input.ExpressionAttributeValues;
      if (previous.owner_sub !== values[":owner"]) throw new Error("conflict");
      if (values[":active"] && (previous.status !== values[":active"] || previous.revision !== values[":revision"])) throw new Error("conflict");
      if (values[":completed"] && previous.status !== "archiving") throw new Error("conflict");
      const next = { ...previous, status: values[":completed"] ?? values[":archiving"] };
      if (values[":completed"]) Object.assign(next, { archive_key: values[":key"], archive_version: values[":version"], archive_sha256: values[":hash"] });
      this.rows.set(this.key(next), next);
      this.writes.push(input);
      return { Attributes: structuredClone(next) };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  }
}
function setup() {
  const database = new Database();
  const uploads: any[] = [];
  let failUpload = false;
  const archive = { send: async (command: any) => {
    if (command.constructor.name === 'GetObjectCommand') {
      expect(command.input.VersionId).toBe('version-1');
      return { Body: { transformToString: async () => uploads.at(-1)!.Body } };
    }
    if (failUpload) throw new Error("S3 unavailable");
    uploads.push(command.input); return { VersionId: "version-1" };
  } };
  const storage = new SessionStorage({ tableName: "deployed-table", bucketName: "private-bucket", dynamo: database as unknown as Pick<DynamoDBDocumentClient, "send">, s3: archive as unknown as Pick<S3Client, "send"> });
  const store = new DynamoSessionStore("us-east-1", "deployed-table", "private-bucket", storage);
  const patientId = "4d619156-3250-4212-8399-129f3280fab1";
  const patientCase = { ...makeCase(), id: patientId };
  const state: EncounterState = { sessionId: "live-1", caseId: patientId, ownerSub: "student-a", status: "active", styleId: "concerned", disclosedFactIds: [], turns: [], createdAt: "2026-10-10T00:00:00Z" };
  return { store, storage, database, uploads, state, patientCase, fail: () => { failUpload = true; }, recover: () => { failUpload = false; } };
}
describe("live encounter storage integration", () => {
  it('persists the real canonical-case engine lifecycle through the authenticated store and exposes its archive to faculty', async () => {
    const { store, storage, database, uploads, fail, recover } = setup();
    const sessions = sessionsForOwner(store, { sub: 'student-a', expiresAt: Date.now() + 60_000 });
    const intruder = sessionsForOwner(store, { sub: 'student-b', expiresAt: Date.now() + 60_000 });
    const cases = new FileCaseRepository(fileURLToPath(new URL('../cases/', import.meta.url)));
    const patientId = '4d619156-3250-4212-8399-129f3280fab1';
    const llm = new FakeLlm();
    const deps: EngineDeps = { sessions, cases, llm: { analyzer: llm, patient: llm, validator: llm }, tts: new FakeTts(), newId: () => 'lifecycle-1', now: () => new Date('2026-10-10T12:00:00Z') };
    const opened = await startEncounter(deps, patientId);
    expect(opened.state).toMatchObject({ ownerSub: 'student-a', revision: 0, status: 'active' });
    expect(database.rows.get('SESSION#lifecycle-1/META')!.encounter_case).toEqual(opened.patientCase);
    await expect(intruder.get('lifecycle-1')).resolves.toBeNull();
    await expect(intruder.getPatientCase!('lifecycle-1')).resolves.toBeNull();
    await expect(intruder.finalizePending!('lifecycle-1')).rejects.toThrow('Session unavailable');
    const fact = opened.patientCase.facts.find(candidate => candidate.disclosure === 'onRequest')!;
    expect(fact).toBeDefined();
    llm.queueJson('analyze_turn', { requestedFactIds: [fact.id], exploredFactIds: [], cues: [] });
    llm.texts.push(fact.content);
    llm.queueJson('validate_reply', { ok: true, issues: [], lockedFactIds: [] });
    // Persistent encounters continue against their pinned case, even if the live catalog disappears.
    deps.cases = { get: async () => null };
    const result = await runTurn(deps, 'lifecycle-1', `Could you tell me about ${fact.topic}?`);
    expect(result.state).toMatchObject({ ownerSub: 'student-a', revision: 1, disclosedFactIds: expect.arrayContaining([fact.id]) });
    expect(result.patientCase).toEqual(opened.patientCase);
    expect((await sessions.get('lifecycle-1'))!.turns.map(turn => turn.text)).toEqual([result.studentTurn.text, fact.content]);
    fail();
    await expect(endEncounter(deps, 'lifecycle-1')).rejects.toThrow('S3 unavailable');
    expect(database.rows.get('SESSION#lifecycle-1/META')!.status).toBe('archiving');
    await expect(getActiveEncounter(deps, 'lifecycle-1')).rejects.toThrow('S3 unavailable');
    recover();
    await expect(getActiveEncounter(deps, 'lifecycle-1')).rejects.toMatchObject({ code: 'SESSION_ENDED' });
    expect(uploads).toHaveLength(1);
    const metadata = await storage.getSession({ subject: 'faculty', role: 'faculty' }, 'lifecycle-1');
    expect(metadata).toMatchObject({ status: 'completed', turn_count: 2, revision: 1, owner_sub: 'student-a' });
    const archive = JSON.parse(await storage.getFacultyTranscript({ subject: 'faculty', role: 'faculty' }, 'lifecycle-1'));
    expect(archive.profile).toEqual(loadPatientProfile(patientId));
    expect(archive.messages.map((message: { text: string }) => message.text)).toEqual([result.studentTurn.text, fact.content]);
    await expect(storage.getFacultyTranscript({ subject: 'student-a', role: 'student' }, 'lifecycle-1')).rejects.toThrow();
  });
  it("uses deployed composite keys, revision transactions and the faculty message contract", async () => {
    const { store, storage, database, state, patientCase } = setup();
    await store.create(state, patientCase);
    expect(state.revision).toBe(0);
    expect(database.rows.get("SESSION#live-1/META")).toMatchObject({ session_id: "live-1", owner_sub: "student-a", status: "active", turn_count: 0, profile_snapshot: loadPatientProfile(state.caseId) });
    const before = (await store.get(state.sessionId))!;
    before.turns = [{ index: 0, speaker: "student", text: "Hello", at: "now" }, { index: 1, speaker: "patient", text: "Hello there", at: "now" }];
    await store.save(before);
    expect(before.revision).toBe(1);
    const restored = (await store.get(state.sessionId))!;
    expect(restored.turns).toHaveLength(2);
    const page = await storage.getMessages({ subject: "faculty", role: "faculty" }, state.sessionId);
    expect(page.messages.map(message => message.text)).toEqual(["Hello", "Hello there"]);
    const listing = await storage.listFacultySessions({ subject: 'faculty', role: 'faculty' });
    expect(listing.sessions).toHaveLength(1);
    expect(listing.sessions[0]).toMatchObject({ session_id: state.sessionId, owner_sub: 'student-a', revision: 1, turn_count: 2 });
    expect(listing.sessions[0]).not.toHaveProperty('encounter_state');
    expect(listing.sessions[0]).not.toHaveProperty('encounter_case');
    await expect(storage.appendExchange({ subject: 'student-a', role: 'student' }, state.sessionId, { expectedRevision: 1, studentText: 'Bypass', patientText: 'Bypass' })).rejects.toThrow(/validated encounter engine/);
    await expect(store.save({ ...before, revision: 0 })).rejects.toThrow();
    await expect(store.save({ ...before, ownerSub: "other-student" })).rejects.toThrow();
    expect(await store.getPatientCase(state.sessionId)).toEqual(patientCase);
  });
  it("uploads a private versioned archive before completing and retries failed archives without accepting new turns", async () => {
    const { store, storage, database, uploads, state, patientCase, fail, recover } = setup();
    await store.create(state, patientCase);
    fail();
    await expect(store.save({ ...state, status: "ended" })).rejects.toThrow("S3 unavailable");
    expect(database.rows.get("SESSION#live-1/META")!.status).toBe("archiving");
    const frozen = (await store.get(state.sessionId))!;
    expect(frozen.status).toBe("ended");
    await expect(store.save({ ...frozen, status: "active" })).rejects.toThrow();
    recover();
    await store.save(frozen);
    expect(database.rows.get("SESSION#live-1/META")).toMatchObject({ status: "completed", archive_version: "version-1" });
    expect(uploads[0]).toMatchObject({ Bucket: "private-bucket", Key: "sessions/live-1/transcript.json", ServerSideEncryption: "AES256" });
    expect(JSON.parse(uploads[0].Body)).toMatchObject({ session: { status: "completed" }, messages: [] });
    expect((await storage.getSession({ subject: "faculty", role: "faculty" }, state.sessionId)).status).toBe("completed");
    const archivedBody = await storage.getFacultyTranscript({ subject: 'faculty', role: 'faculty' }, state.sessionId);
    expect(JSON.parse(archivedBody)).toMatchObject({ session: { session_id: state.sessionId, status: 'completed' }, messages: [] });
    await store.save(frozen);
    expect(uploads).toHaveLength(1);
  });
  it("refuses anonymous durable encounters", async () => {
    const { store, state, patientCase } = setup();
    delete state.ownerSub;
    await expect(store.create(state, patientCase)).rejects.toThrow();
  });
  it('retries a frozen archive on reconnect before reporting that the encounter ended', async () => {
    const { store, state, patientCase, fail, recover, database } = setup();
    await store.create(state, patientCase);
    fail();
    await expect(store.save({ ...state, status: 'ended' })).rejects.toThrow('S3 unavailable');
    const llm = new FakeLlm();
    const deps: EngineDeps = { sessions: store, llm: { analyzer: llm, patient: llm, validator: llm }, tts: new FakeTts(), cases: { get: async () => patientCase } };
    await expect(getActiveEncounter(deps, state.sessionId)).rejects.toThrow('S3 unavailable');
    expect(database.rows.get('SESSION#live-1/META')!.status).toBe('archiving');
    recover();
    await expect(getActiveEncounter(deps, state.sessionId)).rejects.toMatchObject({ code: 'SESSION_ENDED' });
    expect(database.rows.get('SESSION#live-1/META')!.status).toBe('completed');
  });
});
