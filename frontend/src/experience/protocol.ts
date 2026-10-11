/** Boundary adapter for the encounter team's WebSocket protocol. */
import { ChartResponseSchema } from '@casecoach/shared';
import { z } from 'zod';
const turn = z.object({ index: z.number().int().nonnegative(), speaker: z.enum(['student', 'patient']), text: z.string(), at: z.string() });
const fact = z.object({ id: z.string(), topic: z.string(), content: z.string() });
export const serverEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('authenticated') }),
  z.object({ type: z.literal('session_started'), sessionId: z.string().min(1), resumed: z.boolean(), patient: z.object({ name: z.string(), age: z.number(), visitReason: z.string() }), transcript: z.array(turn), disclosedFacts: z.array(fact), chart: ChartResponseSchema.optional(), styleLabel: z.string() }),
  z.object({ type: z.literal('patient_thinking') }),
  z.object({ type: z.literal('patient_turn'), studentTurn: turn, patientTurn: turn, audioBase64: z.string().nullable(), styleLabel: z.string(), disclosedFacts: z.array(fact), chart: ChartResponseSchema.optional() }),
  z.object({ type: z.literal('caption'), text: z.string(), isFinal: z.boolean() }),
  z.object({ type: z.literal('caption_done') }),
  z.object({ type: z.literal('session_ended'), sessionId: z.string() }),
  z.object({ type: z.literal('error'), message: z.string(), code: z.enum(['RESUME_FAILED', 'AUTH_REQUIRED', 'AUTH_FAILED', 'AUTH_EXPIRED']).optional(), scope: z.literal('turn').optional() }),
]);
export type ServerEvent = z.infer<typeof serverEvent>;
export type ConversationTurn = z.infer<typeof turn>;
export type DisclosedFact = z.infer<typeof fact>;
export function parseServerEvent(raw: string): ServerEvent {
  return serverEvent.parse(JSON.parse(raw));
}
export function appendTurns(current: ConversationTurn[], incoming: ConversationTurn[]): ConversationTurn[] {
  const byIndex = new Map(current.map(turn => [turn.index, turn]));
  for (const turn of incoming) byIndex.set(turn.index, turn);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}
