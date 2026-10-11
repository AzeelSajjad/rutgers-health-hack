import type { PatientCase } from "@casecoach/shared";

/** Small case with one fact per disclosure rule. Used by unit tests. */
export function makeCase(): PatientCase {
  return {
    id: "test-case",
    patientName: "Alex Test",
    age: 45,
    sex: "other",
    visitReason: "Follow-up",
    persona: "Alex is polite and busy.",
    voiceId: "Joanna",
    facts: [
      { id: "a", topic: "reason for visit", content: "Here for a follow-up.", disclosure: "atStart" },
      { id: "b", topic: "current medications", content: "Takes metformin 500 mg twice a day.", disclosure: "onRequest" },
      { id: "c", topic: "routine barrier", content: "Skips the evening dose when working late.", disclosure: "whenExplored" },
    ],
    pertinentNegatives: ["No chest pain"],
    learningObjectives: ["Explore medication routine"],
    styles: [
      { id: "concerned", label: "Concerned", description: "Worried, short answers.", mayMinimize: false },
      { id: "engaged", label: "Engaged", description: "Open, fuller answers.", mayMinimize: false },
      { id: "guarded", label: "Guarded", description: "Clipped answers.", mayMinimize: true },
    ],
    initialStyleId: "concerned",
    transitions: [
      { from: "concerned", cue: "acknowledged_concern", to: "engaged" },
      { from: "concerned", cue: "dismissive_or_rushed", to: "guarded" },
      { from: "guarded", cue: "acknowledged_concern", to: "concerned" },
    ],
  };
}
