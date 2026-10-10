import type { ReplyInput } from "./validateReply.js";

export const LEAK_NGRAM = 4;

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

/** Cheap deterministic checks that run before the LLM validator. Returns problems; empty means pass. */
export function precheckReply(input: ReplyInput, reply: string): string[] {
  const c = input.patientCase;
  const disclosed = new Set(input.disclosedFactIds);
  const problems: string[] = [];

  const paddedReply = padded(reply);
  for (const f of lockedFacts(input)) {
    if (repeatsFact(paddedReply, f.content)) problems.push(`Repeats wording from a locked fact (${f.topic}).`);
  }

  const allowed = [
    c.persona,
    c.visitReason,
    String(c.age),
    ...c.pertinentNegatives,
    ...c.facts.filter((f) => disclosed.has(f.id)).map((f) => f.content),
  ].join(" ");
  const allowedNumbers = new Set(allowed.match(/\d+/g) ?? []);
  const stray = [...new Set((reply.match(/\d+/g) ?? []).filter((n) => !allowedNumbers.has(n)))];
  if (stray.length) problems.push(`Mentions numbers that are not in the approved facts: ${stray.join(", ")}.`);

  return problems;
}

/**
 * Replaces any problem that quotes or paraphrases a locked fact with a topic-only line, so locked content
 * never reaches the patient prompt through validator feedback. Other problems pass through unchanged.
 */
export function redactProblems(input: ReplyInput, problems: string[]): string[] {
  const locked = lockedFacts(input);
  return problems.map((p) => {
    const paddedProblem = padded(p);
    const hit = locked.find((f) => repeatsFact(paddedProblem, f.content));
    return hit
      ? `Revealed or hinted at something the patient has not opened up about yet (${hit.topic}).`
      : p;
  });
}
