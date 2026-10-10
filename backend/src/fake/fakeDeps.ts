// FAKE_AWS=1: scripted stand-ins so the frontend can be built and demoed without Bedrock, Polly or Transcribe.
import type { z } from "zod";
import type { CaseRepository } from "../cases/caseRepository.js";
import type { ChatMessage, Llm } from "../llm/llm.js";
import { InMemorySessionStore } from "../sessions/sessionStore.js";
import type { Tts } from "../speech/polly.js";
import type { CaptionHandler, Stt } from "../speech/transcribe.js";
import type { HandlerDeps } from "../ws/sessionHandler.js";

const STOPWORDS = new Set(["what", "with", "about", "does", "have", "your", "that", "this", "from", "they", "when", "where"]);

function scriptedAnalysis(userJson: string) {
  const { facts, latestStudentUtterance } = JSON.parse(userJson) as {
    facts: { id: string; topic: string }[];
    latestStudentUtterance: string;
  };
  const said = latestStudentUtterance.toLowerCase();
  const requested = facts
    .filter((f) => f.topic.toLowerCase().split(/\W+/).some((w) => w.length > 3 && !STOPWORDS.has(w) && said.includes(w)))
    .map((f) => f.id);
  const cues: string[] = [];
  if (/sounds|must be|understand/.test(said)) cues.push("acknowledged_concern");
  if (/\b(how|what|tell me)\b/.test(said)) cues.push("open_ended_question");
  if (/those days|you said|you mentioned/.test(said)) cues.push("follow_up_on_patient_statement");
  return { requestedFactIds: requested, exploredFactIds: cues.includes("open_ended_question") ? requested : [], cues };
}

class ScriptedLlm implements Llm {
  async json<S extends z.ZodType>(args: { purpose: string; system: string; user: string; schema: S }): Promise<z.infer<S>> {
    if (args.purpose === "analyze_turn") return args.schema.parse(scriptedAnalysis(args.user));
    return args.schema.parse({ ok: true, issues: [], lockedFactIds: [] });
  }

  async text(args: { purpose: string; system: string; messages: ChatMessage[] }): Promise<string> {
    const shareable = args.system.split("\n").filter((l) => l.startsWith("- ("));
    const last = shareable.at(-1);
    return last ? last.replace(/^- \([^)]*\)\s*/, "") : "I'm not sure, to be honest.";
  }
}

class SilentTts implements Tts {
  async synthesize(): Promise<Buffer> {
    throw new Error("FAKE_AWS: no audio");
  }
}

class ScriptedStt implements Stt {
  start(onCaption: CaptionHandler, onDone: () => void) {
    let chunks = 0;
    return {
      push: () => {
        chunks++;
      },
      end: () => {
        onCaption(`(fake caption from ${chunks} audio chunks)`, true);
        onDone();
      },
    };
  }
}

export function createFakeDeps(cases: CaseRepository): HandlerDeps {
  const llm = new ScriptedLlm();
  return {
    llm: { analyzer: llm, patient: llm, validator: llm },
    tts: new SilentTts(),
    stt: new ScriptedStt(),
    sessions: new InMemorySessionStore(),
    cases,
    log: (msg) => console.log(`[fake] ${msg}`),
  };
}
