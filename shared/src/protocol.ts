import { z } from "zod";
import type { CueId } from "./case.js";

export type ValidationOutcome = "passed" | "regenerated" | "fallback";

export interface Turn {
  index: number;
  speaker: "student" | "patient";
  text: string;
  at: string;
  /** Student turns: full analyzer output, kept for the future feedback grader ("asked but still locked"). */
  cues?: CueId[];
  requestedFactIds?: string[];
  exploredFactIds?: string[];
  /** Patient turns. */
  styleId?: string;
  newlyDisclosedFactIds?: string[];
  validation?: ValidationOutcome;
}

export interface EncounterState {
  /** Verified Auth0 subject. Legacy ownerless sessions are never exposed over WebSocket. */
  ownerSub?: string;
  /** Persistence revision for optimistic concurrency. */
  revision?: number;
  sessionId: string;
  caseId: string;
  status: "active" | "ended";
  styleId: string;
  disclosedFactIds: string[];
  turns: Turn[];
  createdAt: string;
}

export interface DisclosedFact {
  id: string;
  topic: string;
  content: string;
}

export interface PatientSummary {
  name: string;
  age: number;
  visitReason: string;
}

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start_session"), caseId: z.string().min(1) }),
  z.object({ type: z.literal("resume_session"), sessionId: z.string().min(1) }),
  z.object({ type: z.literal("student_turn"), text: z.string() }),
  z.object({ type: z.literal("caption_start") }),
  z.object({ type: z.literal("caption_stop") }),
  z.object({ type: z.literal("end_session") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: "authenticated" }
  | {
      type: "session_started";
      sessionId: string;
      resumed: boolean;
      patient: PatientSummary;
      styleId: string;
      styleLabel: string;
      disclosedFacts: DisclosedFact[];
      chart?: import("./chart.js").ChartResponse;
      transcript: Turn[];
    }
  | { type: "caption"; text: string; isFinal: boolean }
  | { type: "caption_done" }
  | { type: "patient_thinking" }
  | {
      type: "patient_turn";
      studentTurn: Turn;
      patientTurn: Turn;
      audioBase64: string | null;
      styleId: string;
      styleLabel: string;
      disclosedFacts: DisclosedFact[];
      chart?: import("./chart.js").ChartResponse;
    }
  | { type: "session_ended"; sessionId: string }
  /** scope "turn": the error answers a student_turn, so the client stops waiting and restores the question. */
  | { type: "error"; message: string; code?: "RESUME_FAILED" | "AUTH_REQUIRED" | "AUTH_FAILED" | "AUTH_EXPIRED"; scope?: "turn" };
