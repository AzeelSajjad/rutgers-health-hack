import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  models: {
    analyzer: process.env.ANALYZER_MODEL_ID || "anthropic.claude-haiku-5-5",
    patient: process.env.PATIENT_MODEL_ID || "anthropic.claude-sonnet-5-5",
    validator: process.env.VALIDATOR_MODEL_ID || "anthropic.claude-sonnet-5-5",
  },
  sessionsTable: process.env.SESSIONS_TABLE ?? "",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
  fakeAws: process.env.FAKE_AWS === "1",
};
