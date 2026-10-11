export const STUDENT_TURN_MAX_CHARACTERS = 1000;
export const STUDENT_TURN_MAX_BYTES = 2000;
/** Validate the question as the backend will receive it, preserving the original draft for editing. */
export function studentTurnLimitError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > STUDENT_TURN_MAX_CHARACTERS) return `Shorten your question to ${STUDENT_TURN_MAX_CHARACTERS} characters before sending.`;
  if (new TextEncoder().encode(trimmed).byteLength > STUDENT_TURN_MAX_BYTES) return `Shorten your question to ${STUDENT_TURN_MAX_BYTES} UTF-8 bytes before sending.`;
  return null;
}
