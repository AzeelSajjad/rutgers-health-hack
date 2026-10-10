import { describe, it, expect } from "vitest";
import { fallbackReply, generateValidatedReply, sanitizeReply } from "../src/engine/generateReply.js";
import { makeCase } from "./fixtures.js";
import { FakeLlm } from "./fakes/fakeLlm.js";

const input = {
  patientCase: makeCase(),
  styleId: "concerned",
  disclosedFactIds: ["a"],
  turns: [],
  studentText: "Do you have trouble with your medicine?",
};

function setup() {
  const fake = new FakeLlm();
  const spoken: string[] = [];
  const speak = async (text: string) => {
    spoken.push(text);
    return Buffer.from(`mp3:${text}`);
  };
  return { fake, spoken, deps: { patient: fake, validator: fake, speak } };
}

describe("sanitizeReply", () => {
  it("strips stage directions and collapses whitespace", () => {
    expect(sanitizeReply("*sighs*  I forget  sometimes. [pauses]")).toBe("I forget sometimes.");
  });
});

describe("generateValidatedReply", () => {
  it("returns the first reply and its audio when it passes validation", async () => {
    const { fake, deps } = setup();
    fake.texts.push("*sighs* Sometimes, I guess.");
    fake.queueJson("validate_reply", { ok: true, problems: [] });
    const r = await generateValidatedReply(deps, input);
    expect(r).toMatchObject({ text: "Sometimes, I guess.", validation: "passed", problems: [] });
    expect((await r.audio)?.toString()).toBe("mp3:Sometimes, I guess.");
  });

  it("regenerates once with the validator's problems", async () => {
    const { fake, deps, spoken } = setup();
    fake.texts.push("I'd rather not say why.", "It's... hard to say.");
    fake.queueJson("validate_reply", { ok: false, problems: ["Breaks character"] });
    fake.queueJson("validate_reply", { ok: true, problems: [] });
    const r = await generateValidatedReply(deps, input);
    expect(r.validation).toBe("regenerated");
    expect(r.text).toBe("It's... hard to say.");
    expect(fake.textCalls[1].system).toContain("Breaks character");
    expect(spoken).toEqual(["I'd rather not say why.", "It's... hard to say."]);
    expect((await r.audio)?.toString()).toBe("mp3:It's... hard to say.");
  });

  it("regenerates on precheck problems without calling the validator", async () => {
    const { fake, deps, spoken } = setup();
    fake.texts.push("I skip the evening dose when working late.", "Mm, I'm not sure.");
    fake.queueJson("validate_reply", { ok: true, problems: [] });
    const r = await generateValidatedReply(deps, input);
    expect(r.validation).toBe("regenerated");
    expect(fake.jsonCalls.filter((c) => c.purpose === "validate_reply")).toHaveLength(1);
    expect(spoken).toEqual(["Mm, I'm not sure."]);
  });

  it("falls back to an in-character line after two failed attempts", async () => {
    const { fake, deps } = setup();
    fake.texts.push("bad one", "bad two");
    fake.queueJson("validate_reply", { ok: false, problems: ["Invents a dose"] });
    fake.queueJson("validate_reply", { ok: false, problems: ["Invents a dose"] });
    const r = await generateValidatedReply(deps, input);
    expect(r).toMatchObject({ text: fallbackReply(0), validation: "fallback", problems: ["Invents a dose"] });
    expect((await r.audio)?.toString()).toBe(`mp3:${fallbackReply(0)}`);
  });

  it("treats a reply that is empty after sanitizing as a failure", async () => {
    const { fake, deps, spoken } = setup();
    fake.texts.push("*nods*", "Yes, sometimes.");
    fake.queueJson("validate_reply", { ok: true, problems: [] });
    const r = await generateValidatedReply(deps, input);
    expect(r.validation).toBe("regenerated");
    expect(fake.jsonCalls.filter((c) => c.purpose === "validate_reply")).toHaveLength(1);
    expect(spoken).toEqual(["Yes, sometimes."]);
  });

  it("gives the validator identity, locked facts, negatives and recent conversation", async () => {
    const { fake, deps } = setup();
    fake.texts.push("Not really.");
    fake.queueJson("validate_reply", { ok: true, problems: [] });
    const turns = ["alpha-first-turn", "beta-second-turn", "t2", "t3", "t4", "t5", "t6", "gamma-last-turn"].map(
      (text, index) => ({ index, speaker: "student" as const, text, at: "t" }),
    );
    await generateValidatedReply(deps, { ...input, turns });
    const v = fake.jsonCalls.find((c) => c.purpose === "validate_reply")!;
    expect(v.user).toContain("Alex Test");
    expect(v.user).toContain("Skips the evening dose when working late.");
    expect(v.user).toContain("No chest pain");
    expect(v.user).toContain("mayMinimize");
    expect(v.user).toContain("Here for a follow-up.");
    expect(v.user).toContain(input.studentText);
    expect(v.user).toContain("Not really.");
    expect(v.user).not.toContain("alpha-first-turn");
    expect(v.user).not.toContain("beta-second-turn");
    expect(v.user).toContain("gamma-last-turn");
  });

  it("feeds a precheck problem into the regeneration prompt", async () => {
    const { fake, deps, spoken } = setup();
    fake.texts.push("I take 250 of them.", "Mm, I'm not sure.");
    fake.queueJson("validate_reply", { ok: true, problems: [] });
    const r = await generateValidatedReply(deps, input);
    expect(r.validation).toBe("regenerated");
    expect(fake.textCalls[1].system).toContain("250");
    expect(fake.jsonCalls.filter((c) => c.purpose === "validate_reply")).toHaveLength(1);
    expect(spoken).toEqual(["Mm, I'm not sure."]);
  });

  it("never sends locked fact content from validator problems to the patient prompt", async () => {
    const { fake, deps } = setup();
    fake.texts.push("I'd rather not say.", "Mm, not really.");
    fake.queueJson("validate_reply", { ok: false, problems: ["Says she skips the evening dose when working late"] });
    fake.queueJson("validate_reply", { ok: true, problems: [] });
    const r = await generateValidatedReply(deps, input);
    expect(r.validation).toBe("regenerated");
    expect(fake.textCalls[1].system).not.toContain("evening dose");
    expect(fake.textCalls[1].system).toContain("routine barrier");
  });

  it("rotates fallback lines by turn count", () => {
    expect(fallbackReply(0)).not.toBe(fallbackReply(1));
  });
});
