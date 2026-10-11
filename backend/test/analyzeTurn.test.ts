import { describe, it, expect } from "vitest";
import { analyzeTurn } from "../src/engine/analyzeTurn.js";
import { makeCase } from "./fixtures.js";
import { FakeLlm } from "./fakes/fakeLlm.js";

describe("analyzeTurn", () => {
  it("filters unknown fact ids and duplicates", async () => {
    const llm = new FakeLlm().queueJson("analyze_turn", {
      requestedFactIds: ["b", "zzz", "b"],
      exploredFactIds: [],
      cues: ["open_ended_question", "open_ended_question"],
    });
    const r = await analyzeTurn(llm, { patientCase: makeCase(), turns: [], studentText: "What medicines do you take?" });
    expect(r).toEqual({ requestedFactIds: ["b"], exploredFactIds: [], cues: ["open_ended_question"] });
  });

  it("drops cue ids outside the allowed set instead of failing the turn", async () => {
    const llm = new FakeLlm().queueJson("analyze_turn", {
      requestedFactIds: [],
      exploredFactIds: [],
      cues: ["empathy", "acknowledged_concern"],
    });
    const r = await analyzeTurn(llm, { patientCase: makeCase(), turns: [], studentText: "That sounds hard." });
    expect(r.cues).toEqual(["acknowledged_concern"]);
  });

  it("sends facts, recent turns and the student utterance as data, with few-shot guidance", async () => {
    const llm = new FakeLlm().queueJson("analyze_turn", { requestedFactIds: [], exploredFactIds: [], cues: [] });
    const turns = [
      { index: 0, speaker: "student" as const, text: "Hi there", at: "t" },
      { index: 1, speaker: "patient" as const, text: "Hello", at: "t" },
    ];
    await analyzeTurn(llm, { patientCase: makeCase(), turns, studentText: "How are you sleeping?" });
    const call = llm.jsonCalls[0];
    expect(call.purpose).toBe("analyze_turn");
    expect(call.user).toContain("How are you sleeping?");
    expect(call.user).toContain("routine barrier");
    expect(call.user).toContain("Hello");
    expect(call.system).toContain("acknowledged_concern");
    expect(call.system).toContain("Examples");
  });
});
