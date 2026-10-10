import { describe, it, expect } from "vitest";
import { ClientMessageSchema, PatientCaseSchema, isCueId } from "@casecoach/shared";

const base = {
  id: "t-case",
  patientName: "Test Patient",
  age: 40,
  sex: "female",
  visitReason: "Check-up",
  persona: "Calm.",
  voiceId: "Joanna",
  facts: [{ id: "a", topic: "visit", content: "Here for a check-up.", disclosure: "atStart" }],
  learningObjectives: ["Take a history"],
  styles: [{ id: "calm", label: "Calm", description: "Relaxed." }],
  initialStyleId: "calm",
  transitions: [],
};

describe("PatientCaseSchema", () => {
  it("accepts a valid case and fills defaults", () => {
    const parsed = PatientCaseSchema.parse(base);
    expect(parsed.pertinentNegatives).toEqual([]);
    expect(parsed.styles[0].mayMinimize).toBe(false);
  });

  it("rejects an initialStyleId that is not a defined style", () => {
    expect(PatientCaseSchema.safeParse({ ...base, initialStyleId: "nope" }).success).toBe(false);
  });

  it("rejects transitions to unknown styles", () => {
    const bad = { ...base, transitions: [{ from: "calm", cue: "acknowledged_concern", to: "ghost" }] };
    expect(PatientCaseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate fact ids", () => {
    const bad = { ...base, facts: [base.facts[0], base.facts[0]] };
    expect(PatientCaseSchema.safeParse(bad).success).toBe(false);
  });
});

describe("protocol helpers", () => {
  it("rejects unknown client message types", () => {
    expect(ClientMessageSchema.safeParse({ type: "hack" }).success).toBe(false);
  });

  it("recognizes cue ids", () => {
    expect(isCueId("acknowledged_concern")).toBe(true);
    expect(isCueId("empathy")).toBe(false);
  });
});
