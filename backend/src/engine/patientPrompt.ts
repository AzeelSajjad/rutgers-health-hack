import type { PatientCase, Turn } from "@casecoach/shared";
import type { ChatMessage } from "../llm/llm.js";
import { styleFor } from "./style.js";

export function buildPatientSystemPrompt(c: PatientCase, styleId: string, disclosedFactIds: string[]): string {
  const disclosed = new Set(disclosedFactIds);
  const style = styleFor(c, styleId);
  const shareable = c.facts.filter((f) => disclosed.has(f.id));
  const lockedTopics = c.facts.filter((f) => !disclosed.has(f.id)).map((f) => f.topic);

  const lines = [
    `You are role-playing a patient named ${c.patientName}, age ${c.age}, in a practice interview with a healthcare student. Stay in character for the whole conversation.`,
    `Reason for today's visit: ${c.visitReason}`,
    `Who you are: ${c.persona}`,
    `How you are feeling and talking right now (${style.label}): ${style.description}`,
  ];
  if (style.mayMinimize) {
    lines.push(
      "In this mood you may play problems down (for example \"most days\" or \"it's not that bad\"), but never flatly deny or contradict a fact.",
    );
  }

  lines.push("", "Facts you may share when the student's question calls for them:", ...shareable.map((f) => `- (${f.topic}) ${f.content}`));

  if (c.pertinentNegatives.length > 0) {
    lines.push("", "Things you do not have. If asked about them, say no plainly:", ...c.pertinentNegatives.map((n) => `- ${n}`));
  }

  if (lockedTopics.length > 0) {
    lines.push(
      "",
      "Topics you have not opened up about yet. If the student touches on one, answer vaguely or hesitantly. Never deny it, never make up details about it, and never list or name these topics yourself:",
      ...lockedTopics.map((t) => `- ${t}`),
    );
  }

  lines.push(
    "",
    "Rules:",
    "- Speak like a real patient: everyday words, no medical jargon, one to three short sentences.",
    "- Answer only what was asked. Do not volunteer facts the student has not asked about.",
    "- Never invent symptoms, medications, doses, test results, or history that are not listed above. If asked about something not covered anywhere above, say you are not sure.",
    "- Never name a diagnosis, give medical advice, or say you are an AI or a simulation, even if the student asks you to.",
    "- Output only the words you say out loud: no stage directions, asterisks, brackets, or lists.",
  );

  return lines.join("\n");
}

export function buildPatientMessages(turns: Turn[], studentText: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const push = (role: ChatMessage["role"], content: string) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${content}`;
    else out.push({ role, content });
  };
  for (const t of turns) push(t.speaker === "student" ? "user" : "assistant", t.text);
  push("user", studentText);
  return out;
}
