export interface CaptionState {
  committed: string;
  partial: string;
}

export type CaptionAction = { type: "caption"; text: string; isFinal: boolean } | { type: "reset" };

export const emptyCaptions: CaptionState = { committed: "", partial: "" };

const join = (a: string, b: string) => [a, b].filter(Boolean).join(" ");

export function captionReducer(s: CaptionState, a: CaptionAction): CaptionState {
  if (a.type === "reset") return emptyCaptions;
  return a.isFinal ? { committed: join(s.committed, a.text), partial: "" } : { ...s, partial: a.text };
}

export function captionText(s: CaptionState): string {
  return join(s.committed, s.partial);
}
