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

describe("record diagnosis leakage", () => {
  const frame = (title: string) => `The completed hospital record lists: ${title}. This does not establish current symptoms or treatment.`;
  const record = {
    ...input,
    patientCase: { ...makeCase(), facts: [
      { id: "released", topic: "hospital history diagnosis 1", content: frame("Essential hypertension"), disclosure: "onRequest" as const },
      { id: "hidden", topic: "hospital history diagnosis 2", content: frame("Diabetes mellitus"), disclosure: "onRequest" as const },
      { id: "other", topic: "hospital history diagnosis 3", content: frame("Acute kidney failure with tubular necrosis"), disclosure: "onRequest" as const },
    ] },
    disclosedFactIds: ["released"],
  };

  it("allows the exact released record without matching hidden authored boilerplate", () => {
    expect(precheckReply(record, frame("Essential hypertension"))).toEqual([]);
  });

  it("blocks a short hidden diagnosis without record framing", () => {
    expect(precheckReply(record, "They recorded diabetes mellitus.")).toEqual([{ kind: "locked_wording", factId: "hidden" }]);
  });

  it("blocks hidden clinical wording combined with authorized boilerplate", () => {
    expect(precheckReply(record, frame("Diabetes mellitus"))).toEqual([{ kind: "locked_wording", factId: "hidden" }]);
    expect(precheckReply(record, "The record lists acute kidney failure with tubular necrosis.")).toEqual([{ kind: "locked_wording", factId: "other" }]);
  });

  it("allows authored framing even when no diagnosis is released", () => {
    expect(precheckReply({ ...record, disclosedFactIds: [] }, "The completed hospital record lists some details.")).toEqual([]);
  });

  it("excludes wording authorized by another fact but still detects unique hidden content", () => {
    const patientCase = makeCase();
    patientCase.facts = [
      { id: "a", topic: "reason for visit", content: "I have trouble sleeping at night.", disclosure: "atStart" },
      { id: "b", topic: "routine barrier", content: "I have trouble sleeping at night when working late.", disclosure: "whenExplored" },
    ];
    expect(precheckReply({ ...input, patientCase }, "I have trouble sleeping at night.")).toEqual([]);
    expect(precheckReply({ ...input, patientCase }, "At night when working late it gets worse.")).toEqual([{ kind: "locked_wording", factId: "b" }]);
  });
});
