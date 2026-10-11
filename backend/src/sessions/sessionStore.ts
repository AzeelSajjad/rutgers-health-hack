import type { EncounterState, PatientCase } from "@casecoach/shared";
import { SessionStorage } from "../../app/sessions.js";

export interface SessionStore {
  create(s: EncounterState, patientCase?: PatientCase): Promise<void>;
  get(id: string): Promise<EncounterState | null>;
  save(s: EncounterState): Promise<void>;
  getPatientCase?(id: string): Promise<PatientCase | null>;
  finalizePending?(id: string): Promise<void>;
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
  constructor(region: string, table: string, bucket: string, private readonly storage = new SessionStorage({ region, tableName: table, bucketName: bucket })) {
  }
  async create(s: EncounterState, patientCase?: PatientCase): Promise<void> {
    if (!patientCase) throw new Error("The validated patient case is required for durable encounters");
    await this.storage.createEncounter(s, patientCase);
  }

  async get(id: string): Promise<EncounterState | null> {
    const row = await this.storage.readEncounterRecord(id);
    if (!row?.encounter_state) return null;
    return { ...row.encounter_state, revision: row.revision, ownerSub: row.owner_sub, status: row.status === "active" ? "active" : "ended" };
  }
  async getPatientCase(id: string): Promise<PatientCase | null> {
    return (await this.storage.readEncounterRecord(id))?.encounter_case ?? null;
  }
  async finalizePending(id: string): Promise<void> {
    const row = await this.storage.readEncounterRecord(id);
    if (row?.status === 'archiving') await this.storage.finishSession({ subject: row.owner_sub, role: 'student' }, id);
  }
  async save(s: EncounterState): Promise<void> {
    await this.storage.saveEncounter(s);
  }
}
