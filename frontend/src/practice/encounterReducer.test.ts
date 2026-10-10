import { describe, it, expect } from "vitest";
import type { Turn } from "@casecoach/shared";
import { encounterReducer, initialEncounterView, type EncounterView } from "./encounterReducer";

const turn = (index: number, speaker: Turn["speaker"], text: string, extra: Partial<Turn> = {}): Turn => ({ index, speaker, text, at: "t", ...extra });

const started: EncounterView = encounterReducer(initialEncounterView, {
  type: "session_started",
  sessionId: "s1",
  resumed: false,
  patient: { name: "Morgan Lee", age: 52, visitReason: "Follow-up" },
  styleId: "concerned",
  styleLabel: "Concerned",
  disclosedFacts: [{ id: "a", topic: "reason", content: "Follow-up." }],
  transcript: [],
});

describe("encounterReducer", () => {
  it("starts a session", () => {
    expect(started).toMatchObject({ status: "active", sessionId: "s1", styleLabel: "Concerned", transcript: [] });
  });

  it("restores the transcript on resume", () => {
    const s = encounterReducer(initialEncounterView, {
      type: "session_started",
      sessionId: "s1",
      resumed: true,
      patient: { name: "Morgan Lee", age: 52, visitReason: "Follow-up" },
      styleId: "engaged",
      styleLabel: "Engaged",
      disclosedFacts: [],
      transcript: [turn(0, "student", "Hi"), turn(1, "patient", "Hello")],
    });
    expect(s.transcript).toHaveLength(2);
  });

  it("appends both turns, records a style change and queues audio", () => {
    const s = encounterReducer({ ...started, waiting: true }, {
      type: "patient_turn",
      studentTurn: turn(0, "student", "That sounds hard."),
      patientTurn: turn(1, "patient", "It really is.", { newlyDisclosedFactIds: ["b"] }),
      audioBase64: "AAA=",
      styleId: "engaged",
      styleLabel: "Engaged",
      disclosedFacts: [{ id: "a", topic: "reason", content: "Follow-up." }, { id: "b", topic: "meds", content: "Lisinopril." }],
    });
    expect(s.transcript.map((t) => t.text)).toEqual(["That sounds hard.", "It really is."]);
    expect(s).toMatchObject({ styleLabel: "Engaged", previousStyleLabel: "Concerned", newFactIds: ["b"], waiting: false, pendingAudio: "AAA=" });
  });

  it("clears previousStyleLabel when the style did not change", () => {
    const s = encounterReducer({ ...started, previousStyleLabel: "Guarded" }, {
      type: "patient_turn",
      studentTurn: turn(0, "student", "Ok."),
      patientTurn: turn(1, "patient", "Mm."),
      audioBase64: null,
      styleId: "concerned",
      styleLabel: "Concerned",
      disclosedFacts: started.disclosedFacts,
    });
    expect(s.previousStyleLabel).toBeNull();
  });

  it("an error clears waiting", () => {
    expect(encounterReducer({ ...started, waiting: true }, { type: "error", message: "boom" })).toMatchObject({ waiting: false, error: "boom" });
  });

  it("disconnected clears waiting and marks the connection closed", () => {
    expect(encounterReducer({ ...started, waiting: true, connection: "open" }, { type: "disconnected" })).toMatchObject({ waiting: false, connection: "closed" });
  });

  it("turn_sent sets waiting and clears the error; audio_played clears audio", () => {
    let s = encounterReducer({ ...started, error: "old", pendingAudio: "x" }, { type: "turn_sent" });
    expect(s).toMatchObject({ waiting: true, error: null });
    s = encounterReducer(s, { type: "audio_played" });
    expect(s.pendingAudio).toBeNull();
  });
});
