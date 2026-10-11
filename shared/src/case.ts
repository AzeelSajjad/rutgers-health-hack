import { z } from "zod";

export const CUE_IDS = [
  "acknowledged_concern",
  "open_ended_question",
  "follow_up_on_patient_statement",
  "used_medical_jargon",
  "dismissive_or_rushed",
] as const;
export const CueIdSchema = z.enum(CUE_IDS);
export type CueId = z.infer<typeof CueIdSchema>;
export const isCueId = (x: string): x is CueId => (CUE_IDS as readonly string[]).includes(x);

export const DisclosureSchema = z.enum(["atStart", "onRequest", "whenExplored"]);
export type Disclosure = z.infer<typeof DisclosureSchema>;

export const CaseFactSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  content: z.string().min(1),
  disclosure: DisclosureSchema,
});
export type CaseFact = z.infer<typeof CaseFactSchema>;

export const ResponseStyleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  /** When true, the patient may play problems down in this style but must never flatly deny a fact. */
  mayMinimize: z.boolean().default(false),
});
export type ResponseStyle = z.infer<typeof ResponseStyleSchema>;

export const StyleTransitionSchema = z.object({
  from: z.string().min(1),
  cue: CueIdSchema,
  to: z.string().min(1),
});
export type StyleTransition = z.infer<typeof StyleTransitionSchema>;

export const PatientCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    patientName: z.string().min(1),
    age: z.number().int().positive(),
    sex: z.enum(["female", "male", "other"]),
    visitReason: z.string().min(1),
    persona: z.string().min(1),
    voiceId: z.string().min(1),
    facts: z.array(CaseFactSchema).min(1),
    /** Things the patient does NOT have; answered with a plain "no". */
    pertinentNegatives: z.array(z.string().min(1)).default([]),
    learningObjectives: z.array(z.string().min(1)).min(1),
    styles: z.array(ResponseStyleSchema).min(1),
    initialStyleId: z.string().min(1),
    transitions: z.array(StyleTransitionSchema),
    caseOrigin: z.object({
      kind: z.literal("mimic_iv_demo"), version: z.literal("2.2"),
      citation: z.literal("https://doi.org/10.13026/dp1f-ex47"), license: z.literal("ODbL-1.0"),
      clinicalReviewStatus: z.enum(["not_reviewed", "reviewed"]),
      sourceSubjectId: z.string().regex(/^\d+$/), sourceAdmissionId: z.string().regex(/^\d+$/),
    }).optional(),
  })
  .superRefine((c, ctx) => {
    const styleIds = new Set(c.styles.map((s) => s.id));
    if (!styleIds.has(c.initialStyleId)) {
      ctx.addIssue({ code: "custom", message: `initialStyleId "${c.initialStyleId}" is not a defined style` });
    }
    for (const t of c.transitions) {
      for (const id of [t.from, t.to]) {
        if (!styleIds.has(id)) {
          ctx.addIssue({ code: "custom", message: `transition references unknown style "${id}"` });
        }
      }
    }
    const factIds = c.facts.map((f) => f.id);
    if (new Set(factIds).size !== factIds.length) {
      ctx.addIssue({ code: "custom", message: "duplicate fact ids" });
    }
  });
export type PatientCase = z.infer<typeof PatientCaseSchema>;
