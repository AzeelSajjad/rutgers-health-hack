/** Public encounter presentation only. No hidden clinical facts or teaching rules. */
export interface PatientPresentation {
  key: 'wyatt' | 'yvette' | `random-${string}`; caseId: string; name: string; age: number;
  initials: string; visit: string; subtitle: string; accent: string;
  previewOpening: string; prompts: string[];
}
export const patients: PatientPresentation[] = [
  {
    key: 'wyatt', caseId: '4d619156-3250-4212-8399-129f3280fab1', name: 'Wyatt Nelson', age: 18,
    initials: 'WN', visit: 'Nutrition & cardiovascular health', subtitle: 'A conversation about everyday habits', accent: 'blue',
    previewOpening: "Talking about my eating habits is kind of awkward. Could we take it one question at a time?",
    prompts: ['What does a typical day look like for you?', 'What would you like help with today?', 'Which foods do you usually enjoy?'],
  },
  {
    key: 'yvette', caseId: '6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8', name: 'Yvette Armstrong', age: 64,
    initials: 'YA', visit: 'Understanding blood pressure', subtitle: 'Making health information feel clearer', accent: 'sage',
    previewOpening: "My doctor explained my blood pressure, but I didn't really understand. Could we talk about it?",
    prompts: ['What did your doctor explain to you?', 'What feels confusing about sodium?', 'What would you like to understand better?'],
  },
];
/** Authored, fixed UI preview. Not AI, not medical advice or a validated simulation. */
export function previewReply(patient: PatientPresentation, question: string): string {
  const words = question.toLowerCase();
  if (/medicat|allerg|family|dose/.test(words)) return "That information isn't part of this sample case. Could we talk about the reason for my visit?";
  if (patient.key === 'wyatt') {
    if (/bowel|constipat|bathroom/.test(words)) return "That's a personal question. Could we take this a little slowly?";
    if (/food|eat|fruit|vegetable|diet/.test(words)) return "Talking about my eating habits feels a little awkward. Could we take it one question at a time?";
    if (/cholesterol|lipid/.test(words)) return 'This preview rehearses the conversation flow. Connect to Live AI to explore the actual case facts.';
    if (/bmi|body mass/.test(words)) return 'This preview does not disclose clinical measurements. The live patient backend supplies those details.';
    return "Could we take it one question at a time? Talking about my eating habits feels a little awkward.";
  }
  if (/sodium|salt/.test(words)) return "Could you explain that in everyday language? I want to understand, one thing at a time.";
  if (/reading|blood pressure|number/.test(words)) return 'This preview rehearses the conversation flow. Connect to Live AI to explore the actual case facts.';
  if (/bmi|body mass/.test(words)) return 'This preview does not disclose clinical measurements. The live patient backend supplies those details.';
  return "I want to understand, but medical explanations can feel overwhelming. Could you explain one thing at a time?";
}
