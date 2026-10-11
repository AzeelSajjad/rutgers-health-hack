import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { FileCaseRepository } from "../src/cases/caseRepository.js";
import { buildPatientSystemPrompt } from "../src/engine/patientPrompt.js";

const casesDir = fileURLToPath(new URL("../cases", import.meta.url));
const repo = new FileCaseRepository(casesDir);

describe("FileCaseRepository", () => {
  it.each([
    ['4d619156-3250-4212-8399-129f3280fab1', 'Wyatt Nelson', 'He avoids talking about constipation'],
    ['6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8', 'Yvette Armstrong', 'confused about sodium and salt'],
  ])('serves the selectable case %s without gated content in its initial persona', async (id, name, lockedDetail) => {
    const c = (await repo.get(id))!;
    expect(c.patientName).toBe(name);
    const initial = c.facts.filter(f => f.disclosure === 'atStart').map(f => f.id);
    const prompt = buildPatientSystemPrompt(c, c.initialStyleId, initial);
    expect(prompt).not.toContain(lockedDetail);
    expect(c.facts.some(f => f.disclosure === 'onRequest')).toBe(true);
  });
  it("loads and validates the golden case", async () => {
    const c = await repo.get("morgan-lee");
    expect(c?.patientName).toBe("Morgan Lee");
    expect(c?.pertinentNegatives).toContain("No chest pain");
    expect(c?.styles.find((s) => s.id === "guarded")?.mayMinimize).toBe(true);
  });

  it("hidden (whenExplored) topics never contain their own content", async () => {
    const c = (await repo.get("morgan-lee"))!;
    for (const f of c.facts.filter((x) => x.disclosure === "whenExplored")) {
      expect(f.content.toLowerCase()).not.toContain(f.topic.toLowerCase());
    }
  });

  it("returns null for an unknown case", async () => {
    expect(await repo.get("no-such-case")).toBeNull();
  });

  it("returns null for ids that try to escape the cases directory", async () => {
    expect(await repo.get("../package")).toBeNull();
  });
});
