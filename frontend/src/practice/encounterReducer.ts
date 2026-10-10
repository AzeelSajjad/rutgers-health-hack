import type { DisclosedFact, PatientSummary, ServerMessage, Turn } from "@casecoach/shared";

export interface EncounterView {
  connection: "connecting" | "open" | "closed";
  status: "starting" | "active" | "ended";
  sessionId: string | null;
  /** Counts resumed session_started messages so the page can react to each resume. */
  resumes: number;
  patient: PatientSummary | null;
  styleLabel: string | null;
  previousStyleLabel: string | null;
  transcript: Turn[];
  disclosedFacts: DisclosedFact[];
  newFactIds: string[];
  waiting: boolean;
  pendingAudio: string | null;
  error: string | null;
  /** "turn" when the last error answered a student_turn (the page then restores the question). */
  errorScope: "turn" | null;
}

export type EncounterAction =
  | Exclude<ServerMessage, { type: "caption" } | { type: "caption_done" }>
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "turn_sent" }
  | { type: "audio_played" };

export const initialEncounterView: EncounterView = {
  connection: "connecting",
  status: "starting",
  sessionId: null,
  resumes: 0,
  patient: null,
  styleLabel: null,
  previousStyleLabel: null,
  transcript: [],
  disclosedFacts: [],
  newFactIds: [],
  waiting: false,
  pendingAudio: null,
  error: null,
  errorScope: null,
};

export function encounterReducer(s: EncounterView, a: EncounterAction): EncounterView {
  switch (a.type) {
    case "connecting":
      return { ...s, connection: "connecting" };
    case "connected":
      return { ...s, connection: "open" };
    case "disconnected":
      return { ...s, connection: "closed", waiting: false };
    case "session_started":
      return {
        ...s,
        status: "active",
        sessionId: a.sessionId,
        resumes: a.resumed ? s.resumes + 1 : s.resumes,
        patient: a.patient,
        styleLabel: a.styleLabel,
        previousStyleLabel: null,
        transcript: a.transcript,
        disclosedFacts: a.disclosedFacts,
        newFactIds: [],
        error: null,
        errorScope: null,
      };
    case "turn_sent":
      return { ...s, waiting: true, error: null, errorScope: null };
    case "patient_thinking":
      return { ...s, waiting: true };
    case "patient_turn":
      return {
        ...s,
        transcript: [...s.transcript, a.studentTurn, a.patientTurn],
        previousStyleLabel: s.styleLabel !== a.styleLabel ? s.styleLabel : null,
        styleLabel: a.styleLabel,
        disclosedFacts: a.disclosedFacts,
        newFactIds: a.patientTurn.newlyDisclosedFactIds ?? [],
        waiting: false,
        pendingAudio: a.audioBase64,
      };
    case "audio_played":
      return { ...s, pendingAudio: null };
    case "session_ended":
      return { ...s, status: "ended", waiting: false };
    case "error":
      // Only a turn error ends the wait: a speech or resume error can arrive while a turn is still in flight.
      if (a.scope === "turn") return { ...s, waiting: false, error: a.message, errorScope: "turn" };
      return { ...s, error: a.message, errorScope: null };
  }
}
