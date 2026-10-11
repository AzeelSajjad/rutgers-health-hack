import { describe, it, expect } from "vitest";
import { ChunkQueue, MAX_BUFFERED_BYTES, MAX_STREAM_BYTES, TranscribeStt } from "../src/speech/transcribe.js";

async function drain(q: ChunkQueue): Promise<string[]> {
  const out: string[] = [];
  for await (const c of q) out.push(c.toString());
  return out;
}

const tick = () => new Promise((r) => setImmediate(r));

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
    expect(q.push(Buffer.from("late"))).toBe(false);
    expect(await drain(q)).toEqual([]);
  });

  it("rejects pushes once a stalled consumer would exceed the buffer cap", () => {
    const q = new ChunkQueue();
    const chunk = Buffer.alloc(64 * 1024);
    const results = Array.from({ length: 256 }, () => q.push(chunk));
    const accepted = Math.floor(MAX_BUFFERED_BYTES / chunk.length);
    expect(results.slice(0, accepted).every(Boolean)).toBe(true);
    expect(results.slice(accepted).some(Boolean)).toBe(false);
    expect(q.bufferedBytes).toBeLessThanOrEqual(MAX_BUFFERED_BYTES);
    expect(q.bufferedBytes).toBe(accepted * chunk.length);
  });

  it("frees buffer space as chunks are consumed", async () => {
    const q = new ChunkQueue({ maxBufferedBytes: 4 });
    expect(q.push(Buffer.from("abcd"))).toBe(true);
    expect(q.push(Buffer.from("e"))).toBe(false);
    const it = q[Symbol.asyncIterator]();
    expect((await it.next()).value?.toString()).toBe("abcd");
    expect(q.bufferedBytes).toBe(0);
    expect(q.push(Buffer.from("e"))).toBe(true);
  });

  it("cancel drops buffered chunks and yields nothing more", async () => {
    const q = new ChunkQueue();
    q.push(Buffer.from("a"));
    q.push(Buffer.from("b"));
    q.cancel();
    expect(q.push(Buffer.from("c"))).toBe(false);
    expect(await drain(q)).toEqual([]);
    expect(q.bufferedBytes).toBe(0);
  });

  it("cancel releases a waiting consumer", async () => {
    const q = new ChunkQueue();
    const result = drain(q);
    await Promise.resolve();
    q.cancel();
    expect(await result).toEqual([]);
  });

  it("end, unlike cancel, still drains buffered chunks", async () => {
    const q = new ChunkQueue();
    q.push(Buffer.from("a"));
    q.push(Buffer.from("b"));
    q.end();
    expect(await drain(q)).toEqual(["a", "b"]);
  });
});

/** Stands in for TranscribeStreamingClient: optionally drains the audio stream and rejects when aborted. */
function fakeClient(opts: { drain: boolean }) {
  const calls: { signal?: AbortSignal }[] = [];
  const client = {
    send: (cmd: { input: { AudioStream?: AsyncIterable<unknown> } }, options?: { abortSignal?: AbortSignal }) => {
      const signal = options?.abortSignal;
      calls.push({ signal });
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })));
        if (opts.drain) {
          void (async () => {
            for await (const _ of cmd.input.AudioStream!) {
              /* consume */
            }
            resolve({});
          })();
        }
      });
    },
  };
  return { client, calls };
}

function startWith(opts: { drain: boolean }) {
  const { client, calls } = fakeClient(opts);
  const stt = new TranscribeStt("us-east-1", client as never);
  const events: string[] = [];
  const errors: Error[] = [];
  const stream = stt.start(
    () => {},
    () => events.push("done"),
    (err) => {
      events.push("error");
      errors.push(err as Error);
    },
  );
  return { stream, calls, events, errors };
}

describe("TranscribeStt", () => {
  it("cancel aborts the request and reports done, not error", async () => {
    const { stream, calls, events } = startWith({ drain: false });
    await tick();
    expect(calls[0].signal).toBeDefined();
    stream.cancel();
    expect(calls[0].signal!.aborted).toBe(true);
    await tick();
    expect(events).toEqual(["done"]);
  });

  it("a full buffer (stalled consumer) cancels the stream with an error", async () => {
    const { stream, calls, events, errors } = startWith({ drain: false });
    const chunk = Buffer.alloc(64 * 1024);
    for (let i = 0; i < 256; i++) stream.push(chunk);
    await tick();
    expect(events).toEqual(["error"]);
    expect(errors[0].message).toBe("caption buffer full");
    expect(calls[0].signal!.aborted).toBe(true);
  });

  it("exceeding the per-stream byte budget cancels the stream with an error", async () => {
    const { stream, calls, events, errors } = startWith({ drain: true });
    const chunk = Buffer.alloc(64 * 1024);
    const pushes = Math.ceil(MAX_STREAM_BYTES / chunk.length) + 1;
    for (let i = 0; i < pushes; i++) {
      stream.push(chunk);
      await tick();
    }
    expect(events).toEqual(["error"]);
    expect(errors[0].message).toBe("caption stream limit reached");
    expect(calls[0].signal!.aborted).toBe(true);
  });
});

describe("Transcribe terminal states", () => {
  it("reports a provider rejection after graceful end exactly once", async () => {
    let reject!: (error: Error) => void;
    const client = { send: () => new Promise((_, fail) => { reject = fail; }) };
    const events: unknown[] = [];
    const stream = new TranscribeStt("us-west-2", client as never).start(
      () => events.push("caption"), () => events.push("done"), error => events.push(error),
    );
    stream.end();
    const failure = new Error("Transcribe unavailable after input closed");
    reject(failure);
    await tick();
    stream.end();
    stream.cancel();
    expect(events).toEqual([failure]);
  });

  it("delivers buffered final captions before graceful completion", async () => {
    const received: Buffer[] = [];
    const client = { send: async (cmd: { input: { AudioStream: AsyncIterable<{ AudioEvent: { AudioChunk: Buffer } }> } }) => {
      for await (const event of cmd.input.AudioStream) received.push(event.AudioEvent.AudioChunk);
      return { TranscriptResultStream: (async function* () {
        yield { TranscriptEvent: { Transcript: { Results: [
          { IsPartial: false, Alternatives: [{ Transcript: "Final buffered question" }] },
        ] } } };
      })() };
    } };
    const events: string[] = [];
    const stream = new TranscribeStt("us-west-2", client as never).start(
      (text, final) => events.push(`${final}:${text}`), () => events.push("done"), () => events.push("error"),
    );
    stream.push(Buffer.from("buffered"));
    stream.end();
    stream.push(Buffer.from("ignored"));
    await tick();
    expect(received.map(buffer => buffer.toString())).toEqual(["buffered"]);
    expect(events).toEqual(["true:Final buffered question", "done"]);
  });

  it("does not hide a non-abort provider failure during cancellation", async () => {
    let reject!: (error: Error) => void;
    const client = { send: () => new Promise((_, fail) => { reject = fail; }) };
    const events: unknown[] = [];
    const stream = new TranscribeStt("us-west-2", client as never).start(
      () => {}, () => events.push("done"), error => events.push(error),
    );
    stream.cancel();
    const failure = new Error("Unexpected provider failure");
    reject(failure);
    await tick();
    expect(events).toEqual([failure]);
  });
});
