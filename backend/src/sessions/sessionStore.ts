import type { EncounterState, PatientCase } from "@casecoach/shared";
import { SessionAccessError, SessionConflictError, type SessionActor, type SessionMetadata, SessionStorage } from "../../app/sessions.js";

export interface SessionStore {
  create(s: EncounterState, patientCase?: PatientCase): Promise<void>;
  get(id: string): Promise<EncounterState | null>;
  save(s: EncounterState): Promise<void>;
  getPatientCase?(id: string): Promise<PatientCase | null>;
  finalizePending?(id: string): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  async listFacultySessions(actor:SessionActor,cursor?:Record<string,unknown>) {
    if(actor.role!=="faculty" || !actor.subject)throw new SessionAccessError("Faculty access required");
    const offset=Number(cursor?.offset??0);
    const items=[...this.items.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.sessionId.localeCompare(b.sessionId));
    return {sessions:items.slice(offset,offset+25).map(s=>this.metadata(s)),nextCursor:offset+25<items.length?{offset:offset+25}:null};
  }
  private metadata(s:EncounterState):SessionMetadata {return {session_id:s.sessionId,patient_id:s.caseId,patient_version:1,owner_sub:s.ownerSub!,status:s.status==="ended"?"completed":"active",revision:s.revision??0,turn_count:s.turns.length,created_at:s.createdAt,updated_at:s.turns.at(-1)?.at??s.createdAt};}
  async getFacultyTranscript(actor:SessionActor,id:string) {
    if(actor.role!=="faculty" || !actor.subject)throw new SessionAccessError("Faculty access required");
    const state=this.items.get(id);if(!state)throw new SessionAccessError("Session not found");
    if(state.status!=="ended")throw new SessionConflictError("Session not archived");
    return JSON.stringify({schema_version:1,session:this.metadata(state),profile:this.cases.get(id),messages:state.turns.map((t,i)=>({turn_id:`${id}-${i}`,sequence:i+1,role:t.speaker,text:t.text,created_at:t.at,disclosed_fact_ids:[]}))});
  }
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
  listFacultySessions(actor:SessionActor,cursor?:Record<string,unknown>) {return this.storage.listFacultySessions(actor,cursor);}
  getFacultyTranscript(actor:SessionActor,id:string) {return this.storage.getFacultyTranscript(actor,id);}
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
