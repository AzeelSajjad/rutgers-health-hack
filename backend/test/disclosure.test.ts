import { describe, it, expect } from "vitest";
import type { PatientCase } from "@casecoach/shared";
import {
  MAX_NEW_DISCLOSURES_PER_TURN,
  applyDisclosure,
  disclosedFactsFor,
  initialDisclosedFactIds,
  previouslyRequestedFactIds,
} from "../src/engine/disclosure.js";
import { makeCase } from "./fixtures.js";

const c = makeCase();
const none = { requestedFactIds: [], exploredFactIds: [], cues: [] };

describe("disclosure", () => {
  it("starts with only atStart facts", () => {
    expect(initialDisclosedFactIds(c)).toEqual(["a"]);
  });

  it("unlocks an onRequest fact when it is requested", () => {
    expect(applyDisclosure(c, ["a"], { ...none, requestedFactIds: ["b"] }, [])).toEqual({
      disclosed: ["a", "b"],
      newlyDisclosed: ["b"],
    });
  });

  it("unlocks an onRequest fact when it is explored", () => {
    expect(applyDisclosure(c, ["a"], { ...none, exploredFactIds: ["b"] }, []).newlyDisclosed).toEqual(["b"]);
  });

  it("whenExplored is not unlocked by a direct request", () => {
    expect(applyDisclosure(c, ["a"], { ...none, requestedFactIds: ["c"] }, []).newlyDisclosed).toEqual([]);
  });

  it("whenExplored needs an earlier mention or a follow-up", () => {
    const explored = { ...none, exploredFactIds: ["c"] };
    expect(applyDisclosure(c, ["a"], explored, []).newlyDisclosed).toEqual([]);
    expect(applyDisclosure(c, ["a"], explored, ["c"]).newlyDisclosed).toEqual(["c"]);
    expect(
      applyDisclosure(c, ["a"], { ...explored, cues: ["follow_up_on_patient_statement"] }, []).newlyDisclosed,
    ).toEqual(["c"]);
  });

  it("does not report already-disclosed facts as new", () => {
    expect(applyDisclosure(c, ["a", "b"], { ...none, requestedFactIds: ["b"] }, [])).toEqual({
      disclosed: ["a", "b"],
      newlyDisclosed: [],
    });
  });

  it("ignores unknown fact ids", () => {
    const r = applyDisclosure(c, ["a"], { ...none, requestedFactIds: ["zzz"], exploredFactIds: ["yyy"] }, []);
    expect(r).toEqual({ disclosed: ["a"], newlyDisclosed: [] });
  });

  it(`caps new disclosures at ${MAX_NEW_DISCLOSURES_PER_TURN} per turn, in case order`, () => {
    const big: PatientCase = {
      ...c,
      facts: [
        ...c.facts,
        { id: "d", topic: "sleep", content: "Sleeps 6 hours.", disclosure: "onRequest" },
        { id: "e", topic: "diet", content: "Eats fast food often.", disclosure: "onRequest" },
      ],
    };
    const r = applyDisclosure(big, ["a"], { ...none, requestedFactIds: ["e", "d", "b"] }, []);
    expect(r.newlyDisclosed).toEqual(["b", "d"]);
  });

  it("collects previously requested and explored ids from student turns", () => {
    const ids = previouslyRequestedFactIds([
      { index: 0, speaker: "student", text: "q", at: "t", requestedFactIds: ["b"], exploredFactIds: ["c"] },
      { index: 1, speaker: "patient", text: "r", at: "t" },
      { index: 2, speaker: "student", text: "q2", at: "t" },
    ]);
    expect(ids.sort()).toEqual(["b", "c"]);
  });

  it("maps ids to display facts in case order", () => {
    expect(disclosedFactsFor(c, ["b", "a"]).map((f) => f.id)).toEqual(["a", "b"]);
    expect(disclosedFactsFor(c, ["b"])[0]).toEqual({
      id: "b",
      topic: "current medications",
      content: "Takes metformin 500 mg twice a day.",
    });
  });
});
