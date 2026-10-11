import { describe, it, expect } from "vitest";
import { buildPatientMessages, buildPatientSystemPrompt } from "../src/engine/patientPrompt.js";
import { makeCase } from "./fixtures.js";

const c = makeCase();

describe("buildPatientSystemPrompt", () => {
  it("includes disclosed fact content and the current style", () => {
    const p = buildPatientSystemPrompt(c, "engaged", ["a", "b"]);
    expect(p).toContain("Alex Test");
    expect(p).toContain("Takes metformin 500 mg twice a day.");
    expect(p).toContain("Open, fuller answers.");
  });

  it("lists locked topics without their content and forbids listing them", () => {
    const p = buildPatientSystemPrompt(c, "concerned", ["a"]);
    expect(p).toContain("routine barrier");
    expect(p).toContain("current medications");
    expect(p).not.toContain("Skips the evening dose");
    expect(p).not.toContain("metformin");
    expect(p).toMatch(/never deny/i);
    expect(p).toMatch(/never list/i);
  });

  it("includes pertinent negatives as plain no answers", () => {
    const p = buildPatientSystemPrompt(c, "concerned", ["a"]);
    expect(p).toContain("No chest pain");
    expect(p).toMatch(/say no plainly/i);
  });

  it("allows minimizing only in styles with mayMinimize", () => {
    expect(buildPatientSystemPrompt(c, "guarded", ["a"])).toMatch(/play problems down/i);
    expect(buildPatientSystemPrompt(c, "concerned", ["a"])).not.toMatch(/play problems down/i);
  });

  it("omits the locked-topics section when everything is disclosed", () => {
    expect(buildPatientSystemPrompt(c, "concerned", ["a", "b", "c"])).not.toMatch(/not opened up about/i);
  });
});

describe("buildPatientMessages", () => {
  it("maps speakers to roles and appends the new student text", () => {
    const msgs = buildPatientMessages(
      [
        { index: 0, speaker: "student", text: "Hi", at: "t" },
        { index: 1, speaker: "patient", text: "Hello", at: "t" },
      ],
      "What brings you in?",
    );
    expect(msgs).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "What brings you in?" },
    ]);
  });

  it("merges consecutive same-role messages", () => {
    const msgs = buildPatientMessages([{ index: 0, speaker: "student", text: "Hi", at: "t" }], "Still there?");
    expect(msgs).toEqual([{ role: "user", content: "Hi\nStill there?" }]);
  });
});

describe("record diagnosis instructions", () => {
  it("permits released history with provenance and forbids invented or hidden diagnoses", () => {
    const recordCase = { ...c, facts: [
      ...c.facts,
      { id: "record", topic: "hospital history", content: "The completed hospital record lists: Essential hypertension.", disclosure: "onRequest" as const },
      { id: "hidden-record", topic: "additional hospital history", content: "The completed hospital record lists: Diabetes mellitus.", disclosure: "onRequest" as const },
    ] };
    const prompt = buildPatientSystemPrompt(recordCase, "concerned", ["a", "record"]);
    expect(prompt).toContain("Essential hypertension");
    expect(prompt).not.toContain("Diabetes mellitus");
    expect(prompt).toContain("historical diagnosis only when it is explicitly listed in the shareable facts");
    expect(prompt).toContain("keeping its stated provenance");
    expect(prompt).toContain("Never invent a diagnosis");
    expect(prompt).toContain("reveal hidden diagnoses");
    expect(prompt).not.toContain("Never name a diagnosis");
  });
});
