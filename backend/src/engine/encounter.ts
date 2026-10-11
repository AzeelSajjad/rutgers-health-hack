import { randomUUID } from "node:crypto";
import type { EncounterState, PatientCase, Turn } from "@casecoach/shared";
import type { CaseRepository } from "../cases/caseRepository.js";
import type { LlmRoles } from "../llm/llm.js";
import type { SessionStore } from "../sessions/sessionStore.js";
import type { Tts } from "../speech/polly.js";
import { analyzeTurn } from "./analyzeTurn.js";
import { applyDisclosure, initialDisclosedFactIds, previouslyRequestedFactIds } from "./disclosure.js";
import { generateValidatedReply } from "./generateReply.js";
import { nextStyle } from "./style.js";

export type EncounterErrorCode =
  | "SESSION_NOT_FOUND"
  | "CASE_NOT_FOUND"
  | "SESSION_ENDED"
  | "EMPTY_TURN"
  | "TURN_TOO_LONG"
  | "TURN_LIMIT"
  | "SESSION_FULL";

export class EncounterError extends Error {
  constructor(public readonly code: EncounterErrorCode) {
    super(code);
  }
}

export const MAX_TURN_CHARS = 1000;
/** UTF-8 cap on one student turn, so multi-byte text can't blow the session item size. */
export const MAX_TURN_BYTES = 2_000;
/** Serialized session budget, kept under DynamoDB's 400 KiB item limit with headroom. */
export const MAX_SESSION_BYTES = 350_000;
export const MAX_STUDENT_TURNS = 60;

export interface EngineDeps {
  llm: LlmRoles;
  tts: Tts;
  sessions: SessionStore;
  cases: CaseRepository;
  now?: () => Date;
  newId?: () => string;
  log?: (msg: string, err?: unknown) => void;
}

export interface TurnResult {
  studentTurn: Turn;
  patientTurn: Turn;
  audio: Buffer | null;
  state: EncounterState;
  patientCase: PatientCase;
}

const nowIso = (deps: EngineDeps) => (deps.now ?? (() => new Date()))().toISOString();

async function loadCase(deps: EngineDeps, caseId: string): Promise<PatientCase> {
  const c = await deps.cases.get(caseId);
  if (!c) throw new EncounterError("CASE_NOT_FOUND");
  return c;
}

export async function startEncounter(deps: EngineDeps, caseId: string) {
  const patientCase = await loadCase(deps, caseId);
  const state: EncounterState = {
    sessionId: (deps.newId ?? randomUUID)(),
    caseId,
    status: "active",
    styleId: patientCase.initialStyleId,
    disclosedFactIds: initialDisclosedFactIds(patientCase),
    turns: [],
    createdAt: nowIso(deps),
  };
  await deps.sessions.create(state, patientCase);
  return { state, patientCase };
}

export async function getActiveEncounter(deps: EngineDeps, sessionId: string) {
  const state = await deps.sessions.get(sessionId);
  if (!state) throw new EncounterError("SESSION_NOT_FOUND");
  if (state.status !== "active") throw new EncounterError("SESSION_ENDED");
  const patientCase = await deps.sessions.getPatientCase?.(sessionId) ?? await loadCase(deps, state.caseId);
  return { state, patientCase };
}

export async function runTurn(deps: EngineDeps, sessionId: string, rawText: string): Promise<TurnResult> {
  const text = rawText.trim();
  if (!text) throw new EncounterError("EMPTY_TURN");
  if (text.length > MAX_TURN_CHARS || Buffer.byteLength(text, "utf8") > MAX_TURN_BYTES) {
    throw new EncounterError("TURN_TOO_LONG");
  }

  const { state, patientCase } = await getActiveEncounter(deps, sessionId);
  if (state.turns.filter((t) => t.speaker === "student").length >= MAX_STUDENT_TURNS) {
    throw new EncounterError("TURN_LIMIT");
  }

  const analysis = await analyzeTurn(deps.llm.analyzer, { patientCase, turns: state.turns, studentText: text });
  const { disclosed, newlyDisclosed } = applyDisclosure(
    patientCase,
    state.disclosedFactIds,
    analysis,
    previouslyRequestedFactIds(state.turns),
  );
  const styleId = nextStyle(patientCase, state.styleId, analysis.cues);

  const speak = (t: string) =>
    deps.tts.synthesize(t, patientCase.voiceId).catch((err: unknown) => {
      deps.log?.("tts failed; sending text only", err);
      return null;
    });
  const reply = await generateValidatedReply(
    { patient: deps.llm.patient, validator: deps.llm.validator, speak },
    { patientCase, styleId, disclosedFactIds: disclosed, turns: state.turns, studentText: text },
  );
  if (reply.validation === "fallback") deps.log?.(`reply fell back after validation: ${reply.problems.join("; ")}`);
  const audio = await reply.audio;
  // The patient never actually said anything about the new facts, so don't count them as disclosed.
  const fellBack = reply.validation === "fallback";
  const committedDisclosed = fellBack ? state.disclosedFactIds : disclosed;
  const committedNew = fellBack ? [] : newlyDisclosed;

  const at = nowIso(deps);
  const studentTurn: Turn = {
    index: state.turns.length,
    speaker: "student",
    text,
    at,
    cues: analysis.cues,
    requestedFactIds: analysis.requestedFactIds,
    exploredFactIds: analysis.exploredFactIds,
  };
  const patientTurn: Turn = {
    index: state.turns.length + 1,
    speaker: "patient",
    text: reply.text,
    at,
    styleId,
    newlyDisclosedFactIds: committedNew,
    validation: reply.validation,
  };
  const next: EncounterState = {
    ...state,
    styleId,
    disclosedFactIds: committedDisclosed,
    turns: [...state.turns, studentTurn, patientTurn],
  };
  // Don't persist a turn that would push the session item past the budget; the stored state stays as it was.
  if (Buffer.byteLength(JSON.stringify(next), "utf8") > MAX_SESSION_BYTES) throw new EncounterError("SESSION_FULL");
  await deps.sessions.save(next);
  return { studentTurn, patientTurn, audio, state: next, patientCase };
}

export async function endEncounter(deps: EngineDeps, sessionId: string): Promise<EncounterState> {
  const state = await deps.sessions.get(sessionId);
  if (!state) throw new EncounterError("SESSION_NOT_FOUND");
  const ended: EncounterState = { ...state, status: "ended" };
  await deps.sessions.save(ended);
  return ended;
}
