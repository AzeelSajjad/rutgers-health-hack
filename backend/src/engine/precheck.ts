import type { ReplyInput } from "./validateReply.js";

export const LEAK_NGRAM = 4;
/** Longest patient reply that may be spoken or saved; longer drafts are regenerated, then fall back. */
export const MAX_PATIENT_REPLY_CHARS = 600;

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const padded = (s: string) => ` ${normalize(s)} `;

/** True when the padded, normalized text repeats a run of the fact's words (the whole fact if it is shorter than LEAK_NGRAM). */
function repeatsFact(paddedText: string, content: string): boolean {
  const words = normalize(content).split(" ").filter(Boolean);
  if (!words.length) return false;
  const window = Math.min(LEAK_NGRAM, words.length);
  for (let i = 0; i + window <= words.length; i++) {
    if (paddedText.includes(` ${words.slice(i, i + window).join(" ")} `)) return true;
  }
  return false;
}

const lockedFacts = (input: ReplyInput) => {
  const disclosed = new Set(input.disclosedFactIds);
  return input.patientCase.facts.filter((f) => !disclosed.has(f.id));
};

export type PrecheckIssue =
  | { kind: "locked_wording"; factId: string }
  | { kind: "stray_number" }
  | { kind: "too_long" };

/** Cheap deterministic checks that run before the LLM validator. Returns structured issues; empty means pass. */
export function precheckReply(input: ReplyInput, reply: string): PrecheckIssue[] {
  const c = input.patientCase;
  const disclosed = new Set(input.disclosedFactIds);
  const issues: PrecheckIssue[] = [];
  if (reply.length > MAX_PATIENT_REPLY_CHARS) issues.push({ kind: "too_long" });

  const paddedReply = padded(reply);
  for (const f of lockedFacts(input)) {
    if (repeatsFact(paddedReply, f.content)) issues.push({ kind: "locked_wording", factId: f.id });
  }

  const allowed = [
    c.persona,
    c.visitReason,
    String(c.age),
    ...c.pertinentNegatives,
    ...c.facts.filter((f) => disclosed.has(f.id)).map((f) => f.content),
  ].join(" ");
  const allowedNumbers = new Set(allowed.match(/\d+/g) ?? []);
  if ((reply.match(/\d+/g) ?? []).some((n) => !allowedNumbers.has(n))) issues.push({ kind: "stray_number" });

  return issues;
}
