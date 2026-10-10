import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { FileCaseRepository } from "../src/cases/caseRepository.js";

const casesDir = fileURLToPath(new URL("../cases", import.meta.url));
const repo = new FileCaseRepository(casesDir);

describe("FileCaseRepository", () => {
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
