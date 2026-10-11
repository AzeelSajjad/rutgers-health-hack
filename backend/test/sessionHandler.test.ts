import { describe, it, expect, vi } from "vitest";
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
  llm.queueJson("validate_reply", { ok: true, issues: [], lockedFactIds: [] });
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
    expect(sent[0]).toEqual({ type: "error", message: "No active session", scope: "turn" });
  });

  it("start_session returns the patient summary, style, atStart facts and an empty transcript", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    expect(sent[0]).toEqual({
      type: "session_started",
      chart: { schema_version:1, patient_id:"test-case", patient_version:1, items:[] },
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
    expect(sent).toContainEqual({ type: "error", message: "The patient is still responding", scope: "turn" });
  });

  it.each([
    ["end_session first", ["end_session", "student_turn"]],
    ["student_turn first", ["student_turn", "end_session"]],
  ])("end_session racing a student_turn (%s): exactly one is rejected as busy", async (_label, order) => {
    const { handler, sent, llm } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    queueTurn(llm);
    const msgs = order.map((type) =>
      handler.onMessage(json(type === "student_turn" ? { type, text: "What do you take?" } : { type })),
    );
    await Promise.all(msgs);
    expect(sent.filter((m) => m.type === "error" && m.message === "The patient is still responding")).toHaveLength(1);
    const ended = sent.findIndex((m) => m.type === "session_ended");
    if (ended >= 0) expect(sent.slice(ended + 1).some((m) => m.type === "patient_turn")).toBe(false);
  });

  it("maps engine errors to friendly messages", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    await handler.onMessage(json({ type: "student_turn", text: "   " }));
    expect(sent.at(-1)).toEqual({ type: "error", message: "I didn't catch a question. Please try again.", scope: "turn" });
  });

  it("maps SESSION_FULL to a friendly turn-scoped message", async () => {
    const { handler, sent, llm, deps } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    const state = (await deps.sessions.get("s1"))!;
    await deps.sessions.save({ ...state, turns: [{ index: 0, speaker: "student", text: "x".repeat(349_900), at: "t" }] });
    queueTurn(llm);
    await handler.onMessage(json({ type: "student_turn", text: "What do you take?" }));
    expect(sent.at(-1)).toEqual({
      type: "error",
      message: "This session is full. Please end it and start a new one.",
      scope: "turn",
    });
  });

  it("an engine failure on student_turn is turn-scoped; other errors are not", async () => {
    const { handler, sent, llm } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    llm.failOn = "analyze_turn";
    await handler.onMessage(json({ type: "student_turn", text: "Hello?" }));
    expect(sent.at(-1)).toEqual({ type: "error", message: "Something went wrong. Please try again.", scope: "turn" });
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    expect(sent.at(-1)).toEqual({ type: "error", message: "Session already started" });
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

  it("a resume on another connection waits for an in-flight turn and includes it", async () => {
    const { handler, deps, llm } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ttsCalled = false;
    deps.tts = {
      synthesize: async (text: string) => {
        ttsCalled = true;
        await gate;
        return Buffer.from(`mp3:${text}`);
      },
    };
    queueTurn(llm);
    const turn = handler.onMessage(json({ type: "student_turn", text: "What do you take?" }));
    await vi.waitFor(() => expect(ttsCalled).toBe(true));

    const sent2: ServerMessage[] = [];
    const reconnected = createSessionHandler(deps, (m) => sent2.push(m));
    const resume = reconnected.onMessage(json({ type: "resume_session", sessionId: "s1" }));
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([turn, resume]);

    const msg = sent2[0];
    if (msg.type !== "session_started") throw new Error(`expected session_started, got ${msg.type}`);
    expect(msg.transcript.map((t) => t.text)).toEqual(["What do you take?", "I take a pill twice a day."]);
  });

  it("resume_session for an unknown session fails with RESUME_FAILED", async () => {
    const { handler, sent } = setup();
    await handler.onMessage(json({ type: "resume_session", sessionId: "nope" }));
    expect(sent[0]).toMatchObject({ type: "error", code: "RESUME_FAILED" });
  });

  it("a transient resume failure is not RESUME_FAILED, so the client keeps its session id and retries", async () => {
    const { handler, sent, deps } = setup();
    deps.sessions.get = async () => {
      throw new Error("ProvisionedThroughputExceededException");
    };
    await handler.onMessage(json({ type: "resume_session", sessionId: "s1" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("error");
    expect(sent[0]).not.toHaveProperty("code");
  });

  it("resume_session for an ended session fails with RESUME_FAILED", async () => {
    const { handler, deps } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    await handler.onMessage(json({ type: "end_session" }));
    const sent2: ServerMessage[] = [];
    await createSessionHandler(deps, (m) => sent2.push(m)).onMessage(json({ type: "resume_session", sessionId: "s1" }));
    expect(sent2[0]).toMatchObject({ type: "error", code: "RESUME_FAILED" });
  });

  it("forwards audio to the caption stream, captions to the client, and caption_done", async () => {
    const { handler, sent, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    sent.length = 0;
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

  it("caption_start before start_session is rejected without opening a stream", async () => {
    const { handler, sent, stt } = setup();
    await handler.onMessage(json({ type: "caption_start" }));
    expect(sent).toEqual([{ type: "error", message: "No active session" }]);
    expect(stt.starts).toHaveLength(0);
  });

  it("auto-stops a caption stream after 120 s, and caption_stop cancels the timer", async () => {
    vi.useFakeTimers();
    try {
      const { handler, stt } = setup();
      await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
      await handler.onMessage(json({ type: "caption_start" }));
      vi.advanceTimersByTime(119_999);
      expect(stt.starts[0].cancelled).toBe(0);
      vi.advanceTimersByTime(1);
      expect(stt.starts[0].cancelled).toBe(1);
      expect(stt.starts[0].ended).toBe(0);
      handler.onAudio(Buffer.from([1]));
      expect(stt.pushed).toHaveLength(0);

      await handler.onMessage(json({ type: "caption_start" }));
      await handler.onMessage(json({ type: "caption_stop" }));
      vi.advanceTimersByTime(120_000);
      expect(stt.starts[1].ended).toBe(1);
      expect(stt.starts[1].cancelled).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
    expect(stt.cancelled).toBe(1);
    expect(stt.ended).toBe(0);
  });

  it("caption_stop ends the stream gracefully (end, not cancel) so the final caption still arrives", async () => {
    const { handler, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    await handler.onMessage(json({ type: "caption_start" }));
    await handler.onMessage(json({ type: "caption_stop" }));
    expect(stt.starts[0]).toMatchObject({ ended: 1, cancelled: 0 });
  });

  it("a replacing caption_start cancels the previous stream", async () => {
    const { handler, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    await handler.onMessage(json({ type: "caption_start" }));
    await handler.onMessage(json({ type: "caption_start" }));
    expect(stt.starts[0]).toMatchObject({ ended: 0, cancelled: 1 });
    expect(stt.starts[1]).toMatchObject({ ended: 0, cancelled: 0 });
  });

  it("onClose cancels the open caption stream", async () => {
    const { handler, stt } = setup();
    await handler.onMessage(json({ type: "start_session", caseId: "test-case" }));
    await handler.onMessage(json({ type: "caption_start" }));
    handler.onClose();
    expect(stt.starts[0]).toMatchObject({ ended: 0, cancelled: 1 });
  });
});
