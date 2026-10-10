import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { EncounterState } from "@casecoach/shared";

export interface SessionStore {
  create(s: EncounterState): Promise<void>;
  get(id: string): Promise<EncounterState | null>;
  save(s: EncounterState): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly items = new Map<string, EncounterState>();

  async create(s: EncounterState): Promise<void> {
    if (this.items.has(s.sessionId)) throw new Error(`session ${s.sessionId} already exists`);
    this.items.set(s.sessionId, structuredClone(s));
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

  async create(s: EncounterState): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: s, ConditionExpression: "attribute_not_exists(sessionId)" }),
    );
  }

  async get(id: string): Promise<EncounterState | null> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { sessionId: id }, ConsistentRead: true }));
    return (res.Item as EncounterState | undefined) ?? null;
  }

  async save(s: EncounterState): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: s }));
  }
}
