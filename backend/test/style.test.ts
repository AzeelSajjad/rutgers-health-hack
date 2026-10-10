import { describe, it, expect } from "vitest";
import { nextStyle, styleFor, styleLabel } from "../src/engine/style.js";
import { makeCase } from "./fixtures.js";

const c = makeCase();

describe("nextStyle", () => {
  it("keeps the style when there are no cues", () => {
    expect(nextStyle(c, "concerned", [])).toBe("concerned");
  });

  it("moves concerned → engaged on acknowledged_concern", () => {
    expect(nextStyle(c, "concerned", ["acknowledged_concern"])).toBe("engaged");
  });

  it("ignores cues with no transition from the current style", () => {
    expect(nextStyle(c, "engaged", ["acknowledged_concern"])).toBe("engaged");
  });

  it("applies only the first matching transition in case order", () => {
    expect(nextStyle(c, "concerned", ["dismissive_or_rushed", "acknowledged_concern"])).toBe("engaged");
  });

  it("resets an unknown current style to the initial style", () => {
    expect(nextStyle(c, "deleted-style", [])).toBe("concerned");
  });
});

describe("styleFor / styleLabel", () => {
  it("returns the style, falling back to the initial style", () => {
    expect(styleFor(c, "guarded")).toMatchObject({ label: "Guarded", mayMinimize: true });
    expect(styleFor(c, "nope").id).toBe("concerned");
    expect(styleLabel(c, "engaged")).toBe("Engaged");
  });
});
