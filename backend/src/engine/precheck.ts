import type { ReplyInput } from "./validateReply.js";

export const LEAK_NGRAM = 4;

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Cheap deterministic checks that run before the LLM validator. Returns problems; empty means pass. */
export function precheckReply(input: ReplyInput, reply: string): string[] {
  const c = input.patientCase;
  const disclosed = new Set(input.disclosedFactIds);
  const problems: string[] = [];

  const paddedReply = ` ${normalize(reply)} `;
  for (const f of c.facts) {
    if (disclosed.has(f.id)) continue;
    const words = normalize(f.content).split(" ");
    for (let i = 0; i + LEAK_NGRAM <= words.length; i++) {
      if (paddedReply.includes(` ${words.slice(i, i + LEAK_NGRAM).join(" ")} `)) {
        problems.push(`Repeats wording from a locked fact (${f.topic}).`);
        break;
      }
    }
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
