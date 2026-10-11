import "dotenv/config";

/** Deployment writes these public resource names to work/storage.env. Never silently lose real sessions. */
export function readStorageConfig(env: NodeJS.ProcessEnv, warn: (message: string) => void = console.warn) {
  const canonical = env.SESSION_TABLE_NAME?.trim() ?? "";
  const legacy = env.SESSIONS_TABLE?.trim() ?? "";
  if (canonical && legacy && canonical !== legacy) throw new Error("Conflicting SESSION_TABLE_NAME and SESSIONS_TABLE configuration");
  if (legacy && !canonical) warn("SESSIONS_TABLE is deprecated; use SESSION_TABLE_NAME emitted by deployment.");
  const sessionsTable = canonical || legacy;
  const transcriptBucket = env.TRANSCRIPT_BUCKET_NAME?.trim() ?? "";
  if (env.FAKE_AWS !== "1") {
    if (!sessionsTable) throw new Error("SESSION_TABLE_NAME is required when FAKE_AWS is disabled");
    if (!transcriptBucket) throw new Error("TRANSCRIPT_BUCKET_NAME is required when FAKE_AWS is disabled");
  }
  return { sessionsTable, transcriptBucket };
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  awsRegion: process.env.AWS_REGION ?? "us-west-2",
  models: {
    analyzer: process.env.ANALYZER_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    patient: process.env.PATIENT_MODEL_ID || "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    validator: process.env.VALIDATOR_MODEL_ID || "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  },
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
  fakeAws: process.env.FAKE_AWS === "1",
};
