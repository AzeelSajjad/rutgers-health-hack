import { describe, it, expect } from "vitest";
import { precheckReply } from "../src/engine/precheck.js";
import { makeCase } from "./fixtures.js";

const input = { patientCase: makeCase(), styleId: "concerned", disclosedFactIds: ["a"], turns: [], studentText: "q" };

describe("precheckReply", () => {
  it("passes a clean reply", () => {
    expect(precheckReply(input, "I'm here for a follow-up, I guess.")).toEqual([]);
  });

  it("flags four or more words copied from a locked fact", () => {
    const problems = precheckReply(input, "Well, the evening dose when I'm busy is hard.");
    expect(problems.join(" ")).toMatch(/locked fact \(routine barrier\)/);
  });

  it("flags numbers that are not in approved facts", () => {
    expect(precheckReply(input, "I take 250 of something.").join(" ")).toMatch(/250/);
  });

  it("allows numbers from shareable facts and the patient's age", () => {
    const withMeds = { ...input, disclosedFactIds: ["a", "b"] };
    expect(precheckReply(withMeds, "I'm 45 and take 500 mg.")).toEqual([]);
  });
});
