import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PatientCaseSchema, type PatientCase } from "@casecoach/shared";

export interface CaseRepository {
  get(id: string): Promise<PatientCase | null>;
}

const SAFE_ID = /^[a-z0-9-]+$/;

export class FileCaseRepository implements CaseRepository {
  constructor(private readonly dir: string) {}

  async get(id: string): Promise<PatientCase | null> {
    if (!SAFE_ID.test(id)) return null;
    let raw: string;
    try {
      raw = await readFile(join(this.dir, `${id}.json`), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return PatientCaseSchema.parse(JSON.parse(raw));
  }
}
