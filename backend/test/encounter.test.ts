import { describe, it, expect } from "vitest";
import type { PatientCase, Turn } from "@casecoach/shared";
import {
  EncounterError,
  MAX_SESSION_BYTES,
  MAX_STUDENT_TURNS,
  endEncounter,
  getActiveEncounter,
  runTurn,
  startEncounter,
  type EngineDeps,
} from "../src/engine/encounter.js";
import { InMemorySessionStore } from "../src/sessions/sessionStore.js";
import { makeCase } from "./fixtures.js";
import { FakeLlm } from "./fakes/fakeLlm.js";
import { FakeTts } from "./fakes/fakeTts.js";

function setup() {
  const llm = new FakeLlm();
  const tts = new FakeTts();
  const sessions = new InMemorySessionStore();
  const c = makeCase();
  const deps: EngineDeps = {
    llm: { analyzer: llm, patient: llm, validator: llm },
    tts,
    sessions,
    cases: { get: async (id: string): Promise<PatientCase | null> => (id === c.id ? c : null) },
    now: () => new Date("2026-10-10T12:00:00.000Z"),
    newId: () => "session-1",
    log: () => {},
  };
  return { llm, tts, sessions, deps };
}

function queueHappyTurn(llm: FakeLlm, reply = "I take a pill twice a day.") {
  llm.queueJson("analyze_turn", { requestedFactIds: ["b"], exploredFactIds: [], cues: ["acknowledged_concern"] });
  llm.texts.push(reply);
  llm.queueJson("validate_reply", { ok: true, issues: [], lockedFactIds: [] });
}

describe("startEncounter / getActiveEncounter", () => {
  it("creates an active session with the initial style and atStart facts", async () => {
    const { deps, sessions } = setup();
    const { state } = await startEncounter(deps, "test-case");
    expect(state).toMatchObject({ sessionId: "session-1", status: "active", styleId: "concerned", disclosedFactIds: ["a"], turns: [] });
    expect(await sessions.get("session-1")).toEqual(state);
  });

  it("rejects unknown cases", async () => {
    const { deps } = setup();
    await expect(startEncounter(deps, "nope")).rejects.toMatchObject({ code: "CASE_NOT_FOUND" });
  });

  it("returns an active session for resume and rejects ended or missing ones", async () => {
    const { deps } = setup();
    await startEncounter(deps, "test-case");
    expect((await getActiveEncounter(deps, "session-1")).state.sessionId).toBe("session-1");
    await expect(getActiveEncounter(deps, "missing")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await endEncounter(deps, "session-1");
    await expect(getActiveEncounter(deps, "session-1")).rejects.toMatchObject({ code: "SESSION_ENDED" });
  });
});

describe("runTurn", () => {
  it("runs analyze → disclose → style → reply → tts and persists both turns with the analysis", async () => {
    const { deps, llm, tts, sessions } = setup();
    await startEncounter(deps, "test-case");
    queueHappyTurn(llm);

    const r = await runTurn(deps, "session-1", "  That sounds hard. What medicines do you take?  ");

    expect(r.studentTurn).toMatchObject({
      index: 0,
      speaker: "student",
      text: "That sounds hard. What medicines do you take?",
      cues: ["acknowledged_concern"],
      requestedFactIds: ["b"],
      exploredFactIds: [],
    });
    expect(r.patientTurn).toMatchObject({ index: 1, speaker: "patient", text: "I take a pill twice a day.", styleId: "engaged", newlyDisclosedFactIds: ["b"], validation: "passed" });
    expect(r.audio?.toString()).toBe("mp3:I take a pill twice a day.");
    expect(tts.calls[0].voiceId).toBe("Joanna");
    const saved = (await sessions.get("session-1"))!;
    expect(saved.turns).toHaveLength(2);
    expect(saved.styleId).toBe("engaged");
    expect(saved.disclosedFactIds).toEqual(["a", "b"]);
  });

  it("applies the new style to this reply, not the next one", async () => {
    const { deps, llm } = setup();
    await startEncounter(deps, "test-case");
    queueHappyTurn(llm);
    await runTurn(deps, "session-1", "That sounds hard.");
    expect(llm.textCalls[0].system).toContain("Open, fuller answers.");
  });

  it("unlocks a whenExplored fact on a later turn once it was requested earlier", async () => {
    const { deps, llm, sessions } = setup();
    await startEncounter(deps, "test-case");
    llm.queueJson("analyze_turn", { requestedFactIds: ["c"], exploredFactIds: [], cues: [] });
    llm.texts.push("Hm, sometimes.");
    llm.queueJson("validate_reply", { ok: true, issues: [], lockedFactIds: [] });
    await runTurn(deps, "session-1", "Do you ever miss doses?");
    llm.queueJson("analyze_turn", { requestedFactIds: ["c"], exploredFactIds: ["c"], cues: ["open_ended_question"] });
    llm.texts.push("When I work late I just skip it.");
    llm.queueJson("validate_reply", { ok: true, issues: [], lockedFactIds: [] });
    await runTurn(deps, "session-1", "What usually happens on those days?");
    expect((await sessions.get("session-1"))!.disclosedFactIds).toEqual(["a", "c"]);
  });

  it("does not commit facts as disclosed when the reply falls back, but still records the request", async () => {
    const { deps, llm, sessions } = setup();
    await startEncounter(deps, "test-case");
    llm.queueJson("analyze_turn", { requestedFactIds: ["b"], exploredFactIds: [], cues: [] });
    llm.texts.push("Draft one.", "Draft two.");
    llm.queueJson("validate_reply", { ok: false, issues: ["invents_detail"], lockedFactIds: [] });
    llm.queueJson("validate_reply", { ok: false, issues: ["invents_detail"], lockedFactIds: [] });
    const r = await runTurn(deps, "session-1", "What medicines do you take?");
    expect(r.patientTurn.validation).toBe("fallback");
    expect(r.patientTurn.newlyDisclosedFactIds).toEqual([]);
    expect(r.state.disclosedFactIds).toEqual(["a"]);
    const saved = (await sessions.get("session-1"))!;
    expect(saved.disclosedFactIds).toEqual(["a"]);
    expect(saved.turns[0].requestedFactIds).toEqual(["b"]);
  });

  it("rejects empty text without calling the LLM", async () => {
    const { deps, llm } = setup();
    await startEncounter(deps, "test-case");
    await expect(runTurn(deps, "session-1", "   ")).rejects.toMatchObject({ code: "EMPTY_TURN" });
    expect(llm.jsonCalls).toHaveLength(0);
  });

  it("rejects text over 1000 characters", async () => {
    const { deps } = setup();
    await startEncounter(deps, "test-case");
    await expect(runTurn(deps, "session-1", "a".repeat(1001))).rejects.toMatchObject({ code: "TURN_TOO_LONG" });
  });

  it("rejects 1,000 CJK characters (3,000 UTF-8 bytes) as TURN_TOO_LONG without calling the LLM", async () => {
    const { deps, llm } = setup();
    await startEncounter(deps, "test-case");
    const text = "薬".repeat(1000);
    expect(text.length).toBe(1000);
    expect(Buffer.byteLength(text, "utf8")).toBe(3000);
    await expect(runTurn(deps, "session-1", text)).rejects.toMatchObject({ code: "TURN_TOO_LONG" });
    expect(llm.jsonCalls).toHaveLength(0);
    expect(llm.textCalls).toHaveLength(0);
  });

  it("never speaks or saves a patient draft over 600 characters", async () => {
    const { deps, llm, tts, sessions } = setup();
    await startEncounter(deps, "test-case");
    const long = "Well I just do not really know. ".repeat(22).trim();
    expect(long.length).toBeGreaterThan(600);
    llm.queueJson("analyze_turn", { requestedFactIds: [], exploredFactIds: [], cues: [] });
    llm.texts.push(long, long);
    const r = await runTurn(deps, "session-1", "How are things?");
    expect(r.patientTurn.validation).toBe("fallback");
    expect(r.patientTurn.text).not.toBe(long);
    expect(tts.calls.map((c) => c.text)).not.toContain(long);
    expect(llm.jsonCalls.filter((c) => c.purpose === "validate_reply")).toHaveLength(0);
    expect((await sessions.get("session-1"))!.turns.map((t) => t.text)).not.toContain(long);
  });

  it("throws SESSION_FULL instead of saving a session over the item budget, leaving the stored state unchanged", async () => {
    const { deps, llm, sessions } = setup();
    const { state } = await startEncounter(deps, "test-case");
    const bytes = (s: unknown) => Buffer.byteLength(JSON.stringify(s), "utf8");
    const filler = (len: number): Turn => ({ index: 0, speaker: "student", text: "x".repeat(len), at: "t" });
    const base = bytes({ ...state, turns: [filler(0)] });
    const nearFull = { ...state, turns: [filler(MAX_SESSION_BYTES - 200 - base)] };
    expect(bytes(nearFull)).toBe(MAX_SESSION_BYTES - 200);
    await sessions.save(nearFull);
    queueHappyTurn(llm);
    await expect(runTurn(deps, "session-1", "What medicines do you take?")).rejects.toMatchObject({ code: "SESSION_FULL" });
    expect(await sessions.get("session-1")).toEqual(nearFull);
  });

  it(`rejects turns past ${MAX_STUDENT_TURNS} student turns`, async () => {
    const { deps, sessions } = setup();
    const { state } = await startEncounter(deps, "test-case");
    const turns: Turn[] = Array.from({ length: MAX_STUDENT_TURNS }, (_, i) => ({ index: i, speaker: "student", text: "q", at: "t" }));
    await sessions.save({ ...state, turns });
    await expect(runTurn(deps, "session-1", "One more")).rejects.toMatchObject({ code: "TURN_LIMIT" });
  });

  it("analyzer failure leaves state unchanged", async () => {
    const { deps, llm, sessions } = setup();
    await startEncounter(deps, "test-case");
    llm.failOn = "analyze_turn";
    await expect(runTurn(deps, "session-1", "Hello?")).rejects.toThrow();
    expect((await sessions.get("session-1"))!.turns).toHaveLength(0);
  });

  it("tts failure still returns text and persists the turn", async () => {
    const { deps, llm, tts, sessions } = setup();
    await startEncounter(deps, "test-case");
    tts.fail = true;
    queueHappyTurn(llm);
    const r = await runTurn(deps, "session-1", "What medicines do you take?");
    expect(r.audio).toBeNull();
    expect((await sessions.get("session-1"))!.turns).toHaveLength(2);
  });

  it("rejects turns on unknown and ended sessions", async () => {
    const { deps } = setup();
    await expect(runTurn(deps, "missing", "Hi")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await startEncounter(deps, "test-case");
    await endEncounter(deps, "session-1");
    await expect(runTurn(deps, "session-1", "Hi")).rejects.toBeInstanceOf(EncounterError);
    await expect(runTurn(deps, "session-1", "Hi")).rejects.toMatchObject({ code: "SESSION_ENDED" });
  });
});
