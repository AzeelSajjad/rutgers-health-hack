import { fileURLToPath } from "node:url";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { FileCaseRepository } from "./cases/caseRepository.js";
import { config } from "./config.js";
import { createFakeDeps } from "./fake/fakeDeps.js";
import { BedrockLlm } from "./llm/llm.js";
import { DynamoSessionStore, InMemorySessionStore, type SessionStore } from "./sessions/sessionStore.js";
import { PollyTts } from "./speech/polly.js";
import { TranscribeStt } from "./speech/transcribe.js";
import type { HandlerDeps } from "./ws/sessionHandler.js";

export function createDeps(): HandlerDeps {
  const cases = new FileCaseRepository([
    fileURLToPath(new URL("../cases", import.meta.url)),
    fileURLToPath(new URL("../work/mimic-demo/cases", import.meta.url)),
  ], fileURLToPath(new URL("../work/mimic-demo/source", import.meta.url)));
  if (config.fakeAws) {
    console.warn("FAKE_AWS=1: using scripted fakes, no AWS calls.");
    return createFakeDeps(cases);
  }

  // A stalled call would otherwise hold the session's busy flag for up to 10 minutes per attempt.
  const client = new AnthropicBedrockMantle({ awsRegion: config.awsRegion, timeout: 20_000, maxRetries: 1 });
  let sessions: SessionStore;
  if (config.sessionsTable) {
    sessions = new DynamoSessionStore(config.awsRegion, config.sessionsTable);
  } else {
    console.warn("SESSIONS_TABLE is not set; using in-memory sessions (lost on restart).");
    sessions = new InMemorySessionStore();
  }
  return {
    llm: {
      analyzer: new BedrockLlm(client, config.models.analyzer),
      patient: new BedrockLlm(client, config.models.patient),
      validator: new BedrockLlm(client, config.models.validator),
    },
    tts: new PollyTts(config.awsRegion),
    stt: new TranscribeStt(config.awsRegion),
    sessions,
    cases,
    log: (msg, err) => console.error(`[engine] ${msg}`, err ?? ""),
  };
}
