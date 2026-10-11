import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";

export type CaptionHandler = (text: string, isFinal: boolean) => void;

export interface CaptionStream {
  push(chunk: Buffer): void;
  /** Graceful: Transcribe gets the buffered audio, then the stream finishes (final caption, onDone). */
  end(): void;
  /** Hard stop: drops buffered audio and aborts the request. Reports onDone, not onError. */
  cancel(): void;
}

export interface Stt {
  start(onCaption: CaptionHandler, onDone: () => void, onError: (err: unknown) => void): CaptionStream;
}

/** Not-yet-consumed audio a stream may hold: 10 s of 16 kHz Int16 mono. */
export const MAX_BUFFERED_BYTES = 320_000;
/** Total audio one caption stream may receive: 120 s of 16 kHz Int16 mono. */
export const MAX_STREAM_BYTES = 120 * 32_000;

/** Async-iterable, bounded buffer that bridges WebSocket audio frames to the Transcribe input stream. */
export class ChunkQueue implements AsyncIterable<Buffer> {
  private readonly chunks: Buffer[] = [];
  private readonly waiters: ((r: IteratorResult<Buffer>) => void)[] = [];
  private readonly maxBufferedBytes: number;
  private buffered = 0;
  private done = false;

  constructor(opts: { maxBufferedBytes?: number } = {}) {
    this.maxBufferedBytes = opts.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  }

  /** Bytes pushed but not yet consumed. */
  get bufferedBytes(): number {
    return this.buffered;
  }

  /** Returns false, without buffering, when the queue is closed or the chunk would exceed the buffer cap. */
  push(chunk: Buffer): boolean {
    if (this.done) return false;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: chunk, done: false });
      return true;
    }
    if (this.buffered + chunk.length > this.maxBufferedBytes) return false;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    return true;
  }

  /** Graceful: buffered chunks are still yielded, then iteration stops. */
  end(): void {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  /** Hard stop: drops buffered chunks; nothing more is yielded. */
  cancel(): void {
    this.chunks.length = 0;
    this.buffered = 0;
    this.end();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
    while (true) {
      const next = this.chunks.shift();
      if (next) {
        this.buffered -= next.length;
        yield next;
        continue;
      }
      if (this.done) return;
      const r = await new Promise<IteratorResult<Buffer>>((resolve) => this.waiters.push(resolve));
      if (r.done) return;
      yield r.value;
    }
  }
}

type TranscribeClient = Pick<TranscribeStreamingClient, "send">;

export class TranscribeStt implements Stt {
  private readonly client: TranscribeClient;

  constructor(region: string, client?: TranscribeClient) {
    this.client = client ?? new TranscribeStreamingClient({ region });
  }

  start(onCaption: CaptionHandler, onDone: () => void, onError: (err: unknown) => void): CaptionStream {
    const queue = new ChunkQueue();
    const controller = new AbortController();
    let inputClosed = false;
    let cancelled = false;
    let settled = false;
    let total = 0;
    // A throwing callback must never surface as an unhandled rejection (it would crash the process).
    const safe =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        try {
          fn(...args);
        } catch {
          /* ignore: callback failures are the caller's concern */
        }
      };
    const caption = safe(onCaption);
    // onDone / onError fire at most once between them.
    const once =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (settled) return;
        settled = true;
        inputClosed = true;
        queue.cancel();
        fn(...args);
      };
    const done = once(safe(onDone));
    const error = once(safe(onError));

    const cancel = () => {
      if (settled) return;
      inputClosed = true;
      cancelled = true;
      queue.cancel();
      controller.abort();
    };
    const failWith = (message: string) => {
      cancel();
      error(new Error(message));
    };

    this.run(queue, (text, isFinal) => {
      if (!cancelled && !settled) caption(text, isFinal);
    }, controller.signal)
      .then(done, (err) => {
        queue.cancel();
        // Only an intentional abort is a normal cancellation. Graceful input closure
        // still needs to report provider failures instead of claiming success.
        if (cancelled && err instanceof Error && err.name === "AbortError") done();
        else error(err);
      })
      .catch(() => {});
    return {
      push: (chunk) => {
        if (inputClosed || settled) return;
        total += chunk.length;
        if (total > MAX_STREAM_BYTES) return failWith("caption stream limit reached");
        if (!queue.push(chunk)) failWith("caption buffer full");
      },
      end: () => {
        if (inputClosed || settled) return;
        inputClosed = true;
        queue.end();
      },
      cancel,
    };
  }

  private async run(queue: ChunkQueue, onCaption: CaptionHandler, abortSignal: AbortSignal): Promise<void> {
    async function* audioStream() {
      for await (const chunk of queue) yield { AudioEvent: { AudioChunk: chunk } };
    }
    const res = await this.client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: "en-US",
        MediaEncoding: "pcm",
        MediaSampleRateHertz: 16000,
        AudioStream: audioStream(),
      }),
      { abortSignal },
    );
    if (!res.TranscriptResultStream) return;
    for await (const event of res.TranscriptResultStream) {
      for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
        const text = result.Alternatives?.[0]?.Transcript?.trim();
        if (text) onCaption(text, !result.IsPartial);
      }
    }
  }
}
