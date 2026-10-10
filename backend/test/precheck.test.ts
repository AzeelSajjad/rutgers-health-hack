import { describe, it, expect } from "vitest";
import { MAX_PATIENT_REPLY_CHARS, precheckReply } from "../src/engine/precheck.js";
import { makeCase } from "./fixtures.js";

const input = { patientCase: makeCase(), styleId: "concerned", disclosedFactIds: ["a"], turns: [], studentText: "q" };

describe("precheckReply", () => {
  it("passes a clean reply", () => {
    expect(precheckReply(input, "I'm here for a follow-up, I guess.")).toEqual([]);
  });

  it("flags four or more words copied from a locked fact", () => {
    expect(precheckReply(input, "Well, the evening dose when I'm busy is hard.")).toEqual([
      { kind: "locked_wording", factId: "c" },
    ]);
  });

  it("flags numbers that are not in approved facts", () => {
    expect(precheckReply(input, "I take 250 of something.")).toEqual([{ kind: "stray_number" }]);
  });

  it("allows numbers from shareable facts and the patient's age", () => {
    const withMeds = { ...input, disclosedFactIds: ["a", "b"] };
    expect(precheckReply(withMeds, "I'm 45 and take 500 mg.")).toEqual([]);
  });

  it("flags a reply over MAX_PATIENT_REPLY_CHARS as too_long", () => {
    expect(MAX_PATIENT_REPLY_CHARS).toBe(600);
    expect(precheckReply(input, "a".repeat(600))).toEqual([]);
    expect(precheckReply(input, "a".repeat(601))).toEqual([{ kind: "too_long" }]);
  });
});
