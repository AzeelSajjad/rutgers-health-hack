import type { CueId, PatientCase, ResponseStyle } from "@casecoach/shared";

export function styleFor(c: PatientCase, styleId: string): ResponseStyle {
  return (
    c.styles.find((s) => s.id === styleId) ??
    c.styles.find((s) => s.id === c.initialStyleId) ??
    c.styles[0]
  );
}

export function styleLabel(c: PatientCase, styleId: string): string {
  return styleFor(c, styleId).label;
}

export function nextStyle(c: PatientCase, currentStyleId: string, cues: CueId[]): string {
  const current = c.styles.some((s) => s.id === currentStyleId) ? currentStyleId : c.initialStyleId;
  const seen = new Set(cues);
  const match = c.transitions.find((t) => t.from === current && seen.has(t.cue));
  return match ? match.to : current;
}
