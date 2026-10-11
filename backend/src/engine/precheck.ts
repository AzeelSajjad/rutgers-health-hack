import type { ReplyInput } from "./validateReply.js";

export const LEAK_NGRAM = 4;
/** Longest patient reply that may be spoken or saved; longer drafts are regenerated, then fall back. */
export const MAX_PATIENT_REPLY_CHARS = 600;

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const padded = (s: string) => ` ${normalize(s)} `;

function clinicalContent(content: string): string {
  // These are authored record framing, not identifying clinical details. Keep the
  // diagnosis title between them so even one- or two-word hidden diagnoses match.
  return normalize(content)
    .replace(/^the completed hospital record lists /, "")
    .replace(/ this does not establish current symptoms or treatment$/, "");
}

/** Detect distinctive locked wording; content already authorized is not a leak. */
function repeatsFact(paddedText: string, content: string, authorizedText: string): boolean {
  const words = clinicalContent(content).split(" ").filter(Boolean);
  if (!words.length) return false;
  const window = Math.min(LEAK_NGRAM, words.length);
  for (let i = 0; i + window <= words.length; i++) {
    const phrase = ` ${words.slice(i, i + window).join(" ")} `;
    if (paddedText.includes(phrase) && !authorizedText.includes(phrase)) return true;
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

  const authorizedText = [
    c.persona, c.visitReason, ...c.pertinentNegatives,
    ...c.facts.filter((f) => disclosed.has(f.id)).map((f) => f.content),
  ].map(padded).join(" ");
  const paddedReply = padded(reply);
  for (const f of lockedFacts(input)) {
    if (repeatsFact(paddedReply, f.content, authorizedText)) issues.push({ kind: "locked_wording", factId: f.id });
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
