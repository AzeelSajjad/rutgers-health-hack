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

describe('generated source cache', () => {
  it('shares concurrent initialization, clones sources, invalidates changed imports and retries failures', async () => {
    const {mkdtemp,writeFile,rm} = await import('node:fs/promises');
    const {tmpdir} = await import('node:os');
    const {join} = await import('node:path');
    const {gzipSync} = await import('node:zlib');
    const {vi} = await import('vitest');
    const dir = await mkdtemp(join(tmpdir(),'casecoach-cache-'));
    const files: Record<string,string> = {
      patients:'subject_id,gender,anchor_age,anchor_year\n1,F,60,2150\n',
      admissions:'subject_id,hadm_id,admittime,dischtime,hospital_expire_flag,deathtime\n1,10,2150-01-01,2150-01-02,0,\n',
      diagnoses_icd:'subject_id,hadm_id,seq_num,icd_code,icd_version\n1,10,1,A,10\n',
      d_icd_diagnoses:'icd_code,icd_version,long_title\nA,10,Recorded condition\n',
    };
    try {
      for (const [name,text] of Object.entries(files)) await writeFile(join(dir,`hosp-${name}.csv.gz`),gzipSync(text));
      const cached = new FileCaseRepository(casesDir,undefined,dir);
      // Observe the expensive initializer; assertions use real CSV input and generated cases.
      const initializer = vi.spyOn(cached as unknown as {readSourcePool:()=>Promise<unknown>},'readSourcePool');
      const [a,b] = await Promise.all([cached.generateRandom(),cached.generateRandom()]);
      expect(initializer).toHaveBeenCalledTimes(1);
      expect(a.id).not.toBe(b.id);
      expect(a.caseOrigin).toMatchObject({sourceSubjectId:'1',sourceAdmissionId:'10'});
      a.facts[0].content='mutated';
      expect((await cached.generateRandom()).facts[0].content).not.toBe('mutated');
      expect(initializer).toHaveBeenCalledTimes(1);
      await writeFile(join(dir,'hosp-d_icd_diagnoses.csv.gz'),gzipSync(files.d_icd_diagnoses.replace('Recorded condition','A newly imported recorded condition')));
      expect((await cached.generateRandom()).facts[1].content).toContain('newly imported');
      expect(initializer).toHaveBeenCalledTimes(2);
      initializer.mockRejectedValueOnce(new Error('transient source error'));
      await writeFile(join(dir,'hosp-patients.csv.gz'),gzipSync(files.patients+'2,M,40,2150\n'));
      await expect(cached.generateRandom()).rejects.toThrow('transient');
      await expect(cached.generateRandom()).resolves.toMatchObject({caseOrigin:{sourceSubjectId:'1'}});
      expect(initializer).toHaveBeenCalledTimes(4);
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
});
