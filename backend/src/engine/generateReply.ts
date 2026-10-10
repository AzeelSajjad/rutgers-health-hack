import type { ValidationOutcome } from "@casecoach/shared";
import type { Llm } from "../llm/llm.js";
import { buildPatientMessages, buildPatientSystemPrompt } from "./patientPrompt.js";
import { precheckReply, type PrecheckIssue } from "./precheck.js";
import { renderRetryFeedback } from "./retryFeedback.js";
import { validateReply, type IssueCode, type ReplyInput } from "./validateReply.js";

export type { ReplyInput } from "./validateReply.js";

export const MAX_ATTEMPTS = 2;

export const FALLBACK_REPLIES = [
  "Hm, sorry, I'm not sure what you mean. Could you ask that another way?",
  "Sorry, I lost my train of thought. What were you asking?",
  "I'm not sure how to answer that. Can you put it differently?",
];

export function fallbackReply(turnCount: number): string {
  return FALLBACK_REPLIES[turnCount % FALLBACK_REPLIES.length];
}

/** Must not reject: callers convert TTS errors to null. */
export type Speak = (text: string) => Promise<Buffer | null>;

export interface ReplyResult {
  text: string;
  validation: ValidationOutcome;
  /** Issue codes and precheck kinds from the last rejected draft, for logging only (e.g. "leaks_locked_fact:family-worry"). Never prose. */
  problems: string[];
  audio: Promise<Buffer | null>;
}

export function sanitizeReply(raw: string): string {
  return raw
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateValidatedReply(
  deps: { patient: Llm; validator: Llm; speak: Speak },
  input: ReplyInput,
): Promise<ReplyResult> {
  const baseSystem = buildPatientSystemPrompt(input.patientCase, input.styleId, input.disclosedFactIds);
  const messages = buildPatientMessages(input.turns, input.studentText);
  // Feedback for the next attempt. Only locally templated lines (renderRetryFeedback) ever reach the patient prompt.
  let feedback: string[] = [];
  let problems: string[] = [];
  const reject = (issues: IssueCode[], lockedFactIds: string[], pre: PrecheckIssue[], codes: string[]) => {
    feedback = renderRetryFeedback(input.patientCase, issues, lockedFactIds, pre);
    problems = codes;
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const system = feedback.length
      ? `${baseSystem}\n\nYour previous draft was rejected. Write a new reply that follows these rules:\n${feedback.map((p) => `- ${p}`).join("\n")}`
      : baseSystem;
    const text = sanitizeReply(await deps.patient.text({ purpose: "patient_reply", system, messages }));
    if (!text) {
      reject([], [], [], ["empty"]);
      continue;
    }
    const pre = precheckReply(input, text);
    if (pre.length) {
      reject([], [], pre, pre.map((p) => (p.kind === "locked_wording" ? `${p.kind}:${p.factId}` : p.kind)));
      continue;
    }
    // Start speech synthesis while the validator runs; discarded if validation fails.
    const audio = deps.speak(text);
    const verdict = await validateReply(deps.validator, input, text);
    if (verdict.ok) return { text, validation: attempt === 1 ? "passed" : "regenerated", problems: [], audio };
    audio.catch(() => {}); // audio for a rejected draft is discarded; keep a misbehaving speak from going unhandled
    const codes = verdict.issues.flatMap((i) =>
      i === "leaks_locked_fact" && verdict.lockedFactIds.length ? verdict.lockedFactIds.map((id) => `${i}:${id}`) : [i],
    );
    reject(verdict.issues, verdict.lockedFactIds, [], codes.length ? codes : ["unspecified"]);
  }

  const text = fallbackReply(input.turns.length);
  return { text, validation: "fallback", problems, audio: deps.speak(text) };
}
