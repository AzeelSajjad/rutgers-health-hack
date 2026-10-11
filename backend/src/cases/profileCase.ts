import { z } from 'zod';
import { PatientCaseSchema, ResponseStyleSchema, StyleTransitionSchema, type PatientCase } from '@casecoach/shared';
import { validateProfile, type PatientProfile } from '../../app/profiles.js';

// Simulation presentation is authored separately; clinical data belongs only in the profile.
const SimulationSchema = z.strictObject({
  visitReason: z.string().min(1),
  persona: z.string().min(1),
  voiceId: z.string().min(1),
  styles: z.array(ResponseStyleSchema).min(1),
  initialStyleId: z.string().min(1),
  transitions: z.array(StyleTransitionSchema),
});

export function profileToCase(profile: PatientProfile, simulation: unknown): PatientCase {
  validateProfile(profile);
  const presentation = SimulationSchema.parse(simulation);
  return PatientCaseSchema.parse({
    ...presentation,
    id: profile.id,
    patientName: profile.identity.name,
    age: profile.identity.age,
    sex: profile.identity.gender,
    facts: profile.facts.map(f => ({
      id: f.id,
      topic: f.topics.map(topic => topic.replaceAll('_', ' ')).join('; '),
      content: f.text,
      disclosure: f.visibility === 'initial' ? 'atStart' : 'onRequest',
    })),
    // Unknown information is not a pertinent negative.
    pertinentNegatives: [],
    learningObjectives: profile.learning_objectives,
  });
}
