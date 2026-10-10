import { describe, it, expect } from "vitest";
import { captionReducer, captionText, emptyCaptions } from "./captions";

describe("captionReducer", () => {
  it("shows partials and commits finals", () => {
    let s = captionReducer(emptyCaptions, { type: "caption", text: "what brings", isFinal: false });
    expect(captionText(s)).toBe("what brings");
    s = captionReducer(s, { type: "caption", text: "What brings you in?", isFinal: true });
    s = captionReducer(s, { type: "caption", text: "and when", isFinal: false });
    expect(captionText(s)).toBe("What brings you in? and when");
  });

  it("resets", () => {
    expect(captionReducer({ committed: "a", partial: "b" }, { type: "reset" })).toEqual(emptyCaptions);
  });
});
