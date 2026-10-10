// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Turn } from "@casecoach/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCaptions, type CaptionState } from "./captions";
import { initialEncounterView, type EncounterView } from "./encounterReducer";

const h = vi.hoisted(() => ({
  enc: {} as Record<string, unknown>,
  mic: {} as Record<string, unknown>,
}));

vi.mock("./useEncounterSocket", () => ({ useEncounterSocket: () => h.enc }));
vi.mock("./useMicPcm", () => ({ useMicPcm: () => h.mic }));

import { PracticePage } from "./PracticePage";

const turn = (index: number, speaker: Turn["speaker"], text: string): Turn => ({
  index,
  speaker,
  text,
  at: "2026-01-01T00:00:00Z",
});

const activeView = (over: Partial<EncounterView> = {}): EncounterView => ({
  ...initialEncounterView,
  connection: "open",
  status: "active",
  sessionId: "s1",
  ...over,
});

function setEnc(view: EncounterView, captions: CaptionState = emptyCaptions) {
  h.enc.view = view;
  h.enc.captions = captions;
}

const earlier = [turn(0, "student", "Could you explain?"), turn(1, "patient", "Sure.")];

let sendTurn: ReturnType<typeof vi.fn>;
let finalizing: boolean;
let captionText: string;
let resolveWait: () => void;
let waitForCaptionsDone: ReturnType<typeof vi.fn>;

beforeEach(() => {
  finalizing = false;
  captionText = "";
  sendTurn = vi.fn(() => true);
  waitForCaptionsDone = vi.fn(() => new Promise<void>((r) => (resolveWait = r)));
  Object.assign(h.enc, {
    sendTurn,
    startCaptions: vi.fn(),
    stopCaptions: vi.fn(() => {
      finalizing = true;
    }),
    sendAudio: vi.fn(),
    waitForCaptionsDone,
    isFinalizing: () => finalizing,
    getCaptionText: () => captionText,
    endSession: vi.fn(),
    markAudioPlayed: vi.fn(),
  });
  Object.assign(h.mic, { start: vi.fn(async () => true), stop: vi.fn() });
  setEnc(activeView());
});
afterEach(cleanup);

const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("PracticePage send after Stop", () => {
  it("waits for the final caption when Stop is followed immediately by Send", async () => {
    const { rerender } = render(<PracticePage />);
    fireEvent.click(screen.getByText("Start speaking"));
    await waitFor(() => expect(screen.getByText("Stop")).toBeTruthy());

    setEnc(activeView(), { committed: "", partial: "Do you have any" });
    rerender(<PracticePage />);
    await waitFor(() => expect(textarea().value).toBe("Do you have any"));

    fireEvent.click(screen.getByText("Stop"));
    expect(finalizing).toBe(true);
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(waitForCaptionsDone).toHaveBeenCalledTimes(1));
    expect(sendTurn).not.toHaveBeenCalled();
    captionText = "Do you have any allergies?";
    await act(async () => {
      finalizing = false;
      resolveWait();
    });

    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn).toHaveBeenCalledWith("Do you have any allergies?");
  });
});

describe("PracticePage reconnect recovery", () => {
  async function sendRepeated() {
    setEnc(activeView({ transcript: earlier }));
    const utils = render(<PracticePage />);
    fireEvent.change(textarea(), { target: { value: "Could you explain?" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(sendTurn).toHaveBeenCalledWith("Could you explain?"));
    await waitFor(() => expect(textarea().value).toBe(""));
    return utils;
  }

  it("restores a repeated question that was not saved before the drop", async () => {
    const { rerender } = await sendRepeated();
    setEnc(activeView({ transcript: [...earlier], resumes: 1 }));
    rerender(<PracticePage />);
    await waitFor(() => expect(textarea().value).toBe("Could you explain?"));
  });

  it("does not restore when the resumed transcript has the new student turn", async () => {
    const { rerender } = await sendRepeated();
    const saved = [...earlier, turn(2, "student", "Could you explain?"), turn(3, "patient", "Again.")];
    setEnc(activeView({ transcript: saved, resumes: 1 }));
    rerender(<PracticePage />);
    await act(async () => {});
    expect(textarea().value).toBe("");
  });

  it("restores the question on a turn-scoped error", async () => {
    const { rerender } = await sendRepeated();
    setEnc(activeView({ transcript: [...earlier], error: "boom", errorScope: "turn" }));
    rerender(<PracticePage />);
    await waitFor(() => expect(textarea().value).toBe("Could you explain?"));
  });
});
