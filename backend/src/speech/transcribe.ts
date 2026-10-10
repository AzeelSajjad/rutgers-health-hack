import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";

export type CaptionHandler = (text: string, isFinal: boolean) => void;

export interface CaptionStream {
  push(chunk: Buffer): void;
  end(): void;
}

export interface Stt {
  start(onCaption: CaptionHandler, onDone: () => void, onError: (err: unknown) => void): CaptionStream;
}

/** Async-iterable buffer that bridges WebSocket audio frames to the Transcribe input stream. */
export class ChunkQueue implements AsyncIterable<Buffer> {
  private readonly chunks: Buffer[] = [];
  private readonly waiters: ((r: IteratorResult<Buffer>) => void)[] = [];
  private done = false;

  push(chunk: Buffer): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: chunk, done: false });
    else this.chunks.push(chunk);
  }

  end(): void {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
    while (true) {
      const next = this.chunks.shift();
      if (next) {
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

export class TranscribeStt implements Stt {
  private readonly client: TranscribeStreamingClient;

  constructor(region: string) {
    this.client = new TranscribeStreamingClient({ region });
  }

  start(onCaption: CaptionHandler, onDone: () => void, onError: (err: unknown) => void): CaptionStream {
    const queue = new ChunkQueue();
    let stopped = false;
    this.run(queue, onCaption).then(onDone, (err) => {
      queue.end();
      if (stopped) onDone();
      else onError(err);
    });
    return {
      push: (chunk) => queue.push(chunk),
      end: () => {
        stopped = true;
        queue.end();
      },
    };
  }

  private async run(queue: ChunkQueue, onCaption: CaptionHandler): Promise<void> {
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
