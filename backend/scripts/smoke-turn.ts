// Real-AWS smoke test: Bedrock (Haiku analyzer, Sonnet patient + validator) + Polly, Morgan Lee case.
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeps } from "../src/deps.js";
import { runTurn, startEncounter } from "../src/engine/encounter.js";

const deps = createDeps();
const script = [
  { say: "Hi, I'm a student doctor working with your care team today. What brings you in?", expect: "reason for visit; nothing new disclosed" },
  { say: "How do you manage your medications?", expect: "med-management disclosed (shifts make a routine difficult)" },
  { say: "That sounds hard. What gets in the way on those days?", expect: "cues acknowledged_concern + follow_up; style engaged; routine-barrier disclosed" },
  { say: "Do you ever get chest pain?", expect: "a plain no (pertinent negative)" },
];

const { state } = await startEncounter(deps, "morgan-lee");
console.log(`session ${state.sessionId} style=${state.styleId}`);
const outDir = process.env.SMOKE_OUT_DIR ?? tmpdir();
const outcomes: Record<string, number> = { passed: 0, regenerated: 0, fallback: 0 };
const timings: number[] = [];

for (const [i, step] of script.entries()) {
  const t0 = Date.now();
  const r = await runTurn(deps, state.sessionId, step.say);
  const ms = Date.now() - t0;
  timings.push(ms);
  outcomes[r.patientTurn.validation ?? "passed"]++;
  console.log(`\nSTUDENT: ${step.say}\n  expect: ${step.expect}`);
  console.log(`PATIENT (${r.patientTurn.styleId}, ${r.patientTurn.validation}, ${ms} ms): ${r.patientTurn.text}`);
  console.log(`  cues=${r.studentTurn.cues?.join(",") || "-"} requested=${r.studentTurn.requestedFactIds?.join(",") || "-"} explored=${r.studentTurn.exploredFactIds?.join(",") || "-"} newlyDisclosed=${r.patientTurn.newlyDisclosedFactIds?.join(",") || "-"}`);
  if (r.audio) {
    const file = join(outDir, `smoke-turn-${i}.mp3`);
    await writeFile(file, r.audio);
    console.log(`  audio → ${file}`);
  }
}

const sorted = [...timings].sort((a, b) => a - b);
console.log(`\nvalidation outcomes: ${JSON.stringify(outcomes)}`);
console.log(`latency ms: median=${sorted[Math.floor(sorted.length / 2)]} max=${sorted.at(-1)}`);
