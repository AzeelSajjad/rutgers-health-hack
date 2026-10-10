import { describe, it, expect } from "vitest";
import { ChunkQueue } from "../src/speech/transcribe.js";

async function drain(q: ChunkQueue): Promise<string[]> {
  const out: string[] = [];
  for await (const c of q) out.push(c.toString());
  return out;
}

describe("ChunkQueue", () => {
  it("yields chunks pushed before iteration, then stops on end", async () => {
    const q = new ChunkQueue();
    q.push(Buffer.from("a"));
    q.push(Buffer.from("b"));
    q.end();
    expect(await drain(q)).toEqual(["a", "b"]);
  });

  it("delivers chunks pushed while the consumer is waiting", async () => {
    const q = new ChunkQueue();
    const result = drain(q);
    await Promise.resolve();
    q.push(Buffer.from("x"));
    q.end();
    expect(await result).toEqual(["x"]);
  });

  it("ignores pushes after end", async () => {
    const q = new ChunkQueue();
    q.end();
    q.push(Buffer.from("late"));
    expect(await drain(q)).toEqual([]);
  });
});
