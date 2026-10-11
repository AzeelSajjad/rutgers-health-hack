import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { EncounterState, PatientCase } from "@casecoach/shared";

export interface SessionStore {
  create(s: EncounterState, patientCase?: PatientCase): Promise<void>;
  getPatientCase?(id: string): Promise<PatientCase | null>;
  get(id: string): Promise<EncounterState | null>;
  save(s: EncounterState): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly items = new Map<string, EncounterState>();
  private readonly cases = new Map<string, PatientCase>();

  async create(s: EncounterState, patientCase?: PatientCase): Promise<void> {
    if (this.items.has(s.sessionId)) throw new Error(`session ${s.sessionId} already exists`);
    this.items.set(s.sessionId, structuredClone(s));
    if (patientCase) this.cases.set(s.sessionId, structuredClone(patientCase));
  }

  async getPatientCase(id: string): Promise<PatientCase | null> {
    return structuredClone(this.cases.get(id) ?? null);
  }

  async get(id: string): Promise<EncounterState | null> {
    const s = this.items.get(id);
    return s ? structuredClone(s) : null;
  }

  async save(s: EncounterState): Promise<void> {
    this.items.set(s.sessionId, structuredClone(s));
  }
}

export class DynamoSessionStore implements SessionStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(region: string, private readonly table: string) {
    // Optional Turn fields are often undefined; DynamoDB rejects undefined attribute values unless removed.
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async create(s: EncounterState, patientCase?: PatientCase): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: { ...s, ...(patientCase ? { pinnedCase: patientCase } : {}) }, ConditionExpression: "attribute_not_exists(sessionId)" }),
    );
  }

  async get(id: string): Promise<EncounterState | null> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { sessionId: id }, ConsistentRead: true }));
    if (!res.Item) return null;
    const { pinnedCase, ...state } = res.Item;
    return state as EncounterState;
  }

  async getPatientCase(id: string): Promise<PatientCase | null> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { sessionId: id }, ConsistentRead: true }));
    return (res.Item?.pinnedCase as PatientCase | undefined) ?? null;
  }

  async save(s: EncounterState): Promise<void> {
    const pinnedCase = await this.getPatientCase(s.sessionId);
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { ...s, ...(pinnedCase ? { pinnedCase } : {}) } }));
  }
}
