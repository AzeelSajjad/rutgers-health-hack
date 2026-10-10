import type { ValidationOutcome } from "@casecoach/shared";
import type { Llm } from "../llm/llm.js";
import { buildPatientMessages, buildPatientSystemPrompt } from "./patientPrompt.js";
import { precheckReply, redactProblems } from "./precheck.js";
import { validateReply, type ReplyInput } from "./validateReply.js";

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
  let problems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const system = problems.length
      ? `${baseSystem}\n\nYour previous draft was rejected for these reasons. Write a new reply that avoids them:\n${problems.map((p) => `- ${p}`).join("\n")}`
      : baseSystem;
    const text = sanitizeReply(await deps.patient.text({ purpose: "patient_reply", system, messages }));
    if (!text) {
      problems = ["The reply was empty."];
      continue;
    }
    const pre = precheckReply(input, text);
    if (pre.length) {
      problems = redactProblems(input, pre);
      continue;
    }
    // Start speech synthesis while the validator runs; discarded if validation fails.
    const audio = deps.speak(text);
    const verdict = await validateReply(deps.validator, input, text);
    if (verdict.ok) return { text, validation: attempt === 1 ? "passed" : "regenerated", problems: [], audio };
    audio.catch(() => {}); // audio for a rejected draft is discarded; keep a misbehaving speak from going unhandled
    const reasons = verdict.problems.length ? verdict.problems : ["The reviewer rejected the reply."];
    problems = redactProblems(input, reasons);
  }

  const text = fallbackReply(input.turns.length);
  return { text, validation: "fallback", problems, audio: deps.speak(text) };
}
