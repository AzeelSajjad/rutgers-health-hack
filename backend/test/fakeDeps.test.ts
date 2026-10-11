import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { FileCaseRepository } from "../src/cases/caseRepository.js";
import { runTurn, startEncounter } from "../src/engine/encounter.js";
import { createFakeDeps } from "../src/fake/fakeDeps.js";

describe("FAKE_AWS deps", () => {
  it("run a full Morgan Lee turn without AWS", async () => {
    const deps = createFakeDeps(new FileCaseRepository(fileURLToPath(new URL("../cases", import.meta.url))));
    deps.log = () => {};
    const { state } = await startEncounter(deps, "morgan-lee");
    const r = await runTurn(deps, state.sessionId, "How do you manage your medications?");
    expect(r.patientTurn.text.length).toBeGreaterThan(0);
    expect(r.patientTurn.newlyDisclosedFactIds).toContain("med-management");
    expect(r.audio).toBeNull();
  });
});
