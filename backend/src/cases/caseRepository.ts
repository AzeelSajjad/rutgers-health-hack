import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PatientCaseSchema, type PatientCase } from "@casecoach/shared";
import { loadPatientProfile, PROFILE_DIRECTORY } from "../../app/profiles.js";
import { profileToCase } from "./profileCase.js";

export interface CaseRepository {
  get(id: string): Promise<PatientCase | null>;
}

const SAFE_ID = /^[a-z0-9-]+$/;

export class FileCaseRepository implements CaseRepository {
  constructor(private readonly dir: string, private readonly profilesDir = PROFILE_DIRECTORY) {}

  async get(id: string): Promise<PatientCase | null> {
    if (!SAFE_ID.test(id)) return null;
    let raw: string;
    try {
      raw = await readFile(join(this.dir, `${id}.json`), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      try {
        raw = await readFile(join(this.dir, `${id}.simulation.json`), "utf8");
      } catch (simulationError) {
        if ((simulationError as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw simulationError;
      }
      return profileToCase(loadPatientProfile(id, this.profilesDir), JSON.parse(raw));
    }
    return PatientCaseSchema.parse(JSON.parse(raw));
  }
}
