import { describe, it, expect } from "vitest";
import type { PatientCase, ServerMessage } from "@casecoach/shared";
import { createSessionHandler, type HandlerDeps } from "../src/ws/sessionHandler.js";
import { InMemorySessionStore } from "../src/sessions/sessionStore.js";
import { makeCase } from "./fixtures.js";
import { FakeLlm } from "./fakes/fakeLlm.js";
import { FakeStt } from "./fakes/fakeStt.js";
import { FakeTts } from "./fakes/fakeTts.js";

function setup() {
  const llm = new FakeLlm();
  const stt = new FakeStt();
  const c = makeCase();
  const deps: HandlerDeps = {
    llm: { analyzer: llm, patient: llm, validator: llm },
    tts: new FakeTts(),
    sessions: new InMemorySessionStore(),
    cases: { get: async (id: string): Promise<PatientCase | null> => (id === c.id ? c : null) },
    stt,
    newId: () => "s1",
    log: () => {},
  };
  const sent: ServerMessage[] = [];
  const handler = createSessionHandler(deps, (m) => sent.push(m));
  return { llm, stt, deps, handler, sent };
}

const json = (m: unknown) => JSON.stringify(m);

function queueTurn(llm: FakeLlm) {
  llm.queueJson("analyze_turn", { requestedFactIds: ["b"], exploredFactIds: [], cues: [] });
  llm.texts.push("I take a pill twice a day.");
  llm.queueJson("validate_reply", { ok: true, problems: [] });
}

describe("session handler", () => {
  it("invalid JSON yields an error", async () => {
    const { handler, sent } = setup();
    await handler.onMessage("not json");
    expect(sent).toEqual([{ type: "error", message: "Invalid message" }]);
  });

  it("unknown type yields an error", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "hack" }));
    expect(sent[0]).toEqual({ type: "error", message: "Invalid message" });
  });

  it("student_turn before start_session yields an error", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "student_turn", text: "Hi" }));
    expect(sent[0]).toEqual({ type: "error", message: "No active session" });
  });

  it("start_session returns the patient summary, style, atStart facts and an empty transcript", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    expect(sent[0]).toEqual({
      type: "session_started",
      sessionId: "s1",
      resumed: false,
      patient: { name: "Alex Test", age: 45, visitReason: "Follow-up" },
      styleId: "concerned",
      styleLabel: "Concerned",
      disclosedFacts: [{ id: "a", topic: "reason for visit", content: "Here for a follow-up." }],
      transcript: [],
    });
  });

  it("student_turn sends patient_thinking then patient_turn with audio", async () => {
    const { handler, sent, llm } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    queueTurn(llm);
    await handler.onMessage(json({ type: "student_turn", text: "What do you take?" }));
    expect(sent[1]).toEqual({ type: "patient_thinking" });
    const turn = sent[2];
    if (turn.type !== "patient_turn") throw new Error(`expected patient_turn, got ${turn.type}`);
    expect(turn.patientTurn.text).toBe("I take a pill twice a day.");
    expect(Buffer.from(turn.audioBase64!, "base64").toString()).toBe("mp3:I take a pill twice a day.");
    expect(turn.disclosedFacts.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("rejects a second student_turn while one is in flight", async () => {
    const { handler, sent, llm } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    queueTurn(llm);
    const first = handler.onMessage(json({ type: "student_turn", text: "One" }));
    const second = handler.onMessage(json({ type: "student_turn", text: "Two" }));
    await Promise.all([first, second]);
    expect(sent.filter((m) => m.type === "patient_turn")).toHaveLength(1);
    expect(sent).toContainEqual({ type: "error", message: "The patient is still responding" });
  });

  it("maps engine errors to friendly messages", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    await handler.onMessage(json({ type: "student_turn", text: "   " }));
    expect(sent.at(-1)).toEqual({ type: "error", message: "I didn't catch a question. Please try again." });
  });

  it("resume_session on a new connection restores the transcript", async () => {
    const { handler, deps, llm } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    queueTurn(llm);
    await handler.onMessage(json({ type: "student_turn", text: "What do you take?" }));

    const sent2: ServerMessage[] = [];
    const reconnected = createSessionHandler(deps, (m) => sent2.push(m));
    await reconnected.onMessage(json({ type: "resume_session", sessionId: "s1" }));
    const msg = sent2[0];
    if (msg.type !== "session_started") throw new Error(`expected session_started, got ${msg.type}`);
    expect(msg.resumed).toBe(true);
    expect(msg.transcript).toHaveLength(2);
    expect(msg.disclosedFacts.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("resume_session for an unknown session fails with RESUME_FAILED", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "resume_session", sessionId: "nope" }));
    expect(sent[0]).toMatchObject({ type: "error", code: "RESUME_FAILED" });
  });

  it("forwards audio to the caption stream, captions to the client, and caption_done", async () => {
    const { handler, sent, stt } = setup();
    await handler.onMessage(json({ type: "caption_start" }));
    handler.onAudio(Buffer.from([1, 2]));
    stt.starts[0].onCaption("what brings", false);
    stt.starts[0].onCaption("What brings you in?", true);
    await handler.onMessage(json({ type: "caption_stop" }));
    stt.starts[0].onDone();
    expect(stt.pushed).toHaveLength(1);
    expect(stt.ended).toBe(1);
    expect(sent).toEqual([
      { type: "caption", text: "what brings", isFinal: false },
      { type: "caption", text: "What brings you in?", isFinal: true },
      { type: "caption_done" },
    ]);
  });

  it("ignores callbacks from a caption stream that was replaced, and forwards the new one", async () => {
    const { handler, sent, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    sent.length = 0;
    await handler.onMessage(json({ type: "caption_start" }));
    await handler.onMessage(json({ type: "caption_start" }));
    const [a, b] = stt.starts;
    a.onCaption("stale words", true);
    a.onDone();
    a.onError(new Error("late failure"));
    expect(sent).toEqual([]);
    b.onCaption("fresh words", false);
    b.onDone();
    expect(sent).toEqual([
      { type: "caption", text: "fresh words", isFinal: false },
      { type: "caption_done" },
    ]);
  });

  it("sends caption_done at most once per stream across the error and done paths", async () => {
    const { handler, sent, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    sent.length = 0;
    await handler.onMessage(json({ type: "caption_start" }));
    stt.starts[0].onError(new Error("network"));
    stt.starts[0].onDone();
    expect(sent.filter((m) => m.type === "caption_done")).toHaveLength(1);
    expect(sent.filter((m) => m.type === "error")).toHaveLength(1);
  });

  it("a throwing stt.start on caption_start sends an error instead of rejecting", async () => {
    const { handler, sent, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    sent.length = 0;
    stt.failStart = true;
    await expect(handler.onMessage(json({ type: "caption_start" }))).resolves.toBeUndefined();
    expect(sent).toEqual([{ type: "error", message: "Something went wrong. Please try again." }]);
    expect(() => handler.onAudio(Buffer.from([1]))).not.toThrow();
  });

  it("audio before caption_start is ignored", () => {
    const { handler, stt } = setup();
    expect(() => handler.onAudio(Buffer.from([1]))).not.toThrow();
    expect(stt.pushed).toHaveLength(0);
  });

  it("end_session ends the session and closes captions", async () => {
    const { handler, sent, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    await handler.onMessage(json({ type: "caption_start" }));
    await handler.onMessage(json({ type: "end_session" }));
    expect(sent.at(-1)).toEqual({ type: "session_ended", sessionId: "s1" });
    expect(stt.ended).toBe(1);
  });
});
