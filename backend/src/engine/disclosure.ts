import type { CueId, DisclosedFact, PatientCase, Turn } from "@casecoach/shared";

export const MAX_NEW_DISCLOSURES_PER_TURN = 2;

export interface DisclosureSignals {
  requestedFactIds: string[];
  exploredFactIds: string[];
  cues: CueId[];
}

export function initialDisclosedFactIds(c: PatientCase): string[] {
  return c.facts.filter((f) => f.disclosure === "atStart").map((f) => f.id);
}

export function previouslyRequestedFactIds(turns: Turn[]): string[] {
  const ids = new Set<string>();
  for (const t of turns) {
    if (t.speaker !== "student") continue;
    for (const id of [...(t.requestedFactIds ?? []), ...(t.exploredFactIds ?? [])]) ids.add(id);
  }
  return [...ids];
}

export function applyDisclosure(
  c: PatientCase,
  alreadyDisclosed: string[],
  signals: DisclosureSignals,
  previouslyRequested: string[],
): { disclosed: string[]; newlyDisclosed: string[] } {
  const already = new Set(alreadyDisclosed);
  const requested = new Set(signals.requestedFactIds);
  const explored = new Set(signals.exploredFactIds);
  const earlier = new Set(previouslyRequested);
  const followUp = signals.cues.includes("follow_up_on_patient_statement");

  const newlyDisclosed = c.facts
    .filter((f) => {
      if (already.has(f.id)) return false;
      if (f.disclosure === "onRequest") return requested.has(f.id) || explored.has(f.id);
      if (f.disclosure === "whenExplored") return explored.has(f.id) && (earlier.has(f.id) || followUp);
      return false;
    })
    .slice(0, MAX_NEW_DISCLOSURES_PER_TURN)
    .map((f) => f.id);

  const all = new Set([...already, ...newlyDisclosed]);
  const disclosed = c.facts.filter((f) => all.has(f.id)).map((f) => f.id);
  return { disclosed, newlyDisclosed };
}

export function disclosedFactsFor(c: PatientCase, ids: string[]): DisclosedFact[] {
  const wanted = new Set(ids);
  return c.facts
    .filter((f) => wanted.has(f.id))
    .map(({ id, topic, content }) => ({ id, topic, content }));
}

/** Project only already-disclosed, pinned chart values; callers never choose release IDs. */
export function disclosedChartFor(c: import("@casecoach/shared").PatientCase, ids: readonly string[]): import("@casecoach/shared").ChartResponse {
  const released = new Set(ids);
  return {schema_version:1,patient_id:c.id,patient_version:c.profileVersion??1,items:c.facts.filter(f=>released.has(f.id)).flatMap(f=>f.chart?[structuredClone(f.chart)]:[])};
}
