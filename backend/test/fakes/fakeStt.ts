import type { CaptionHandler, CaptionStream, Stt } from "../../src/speech/transcribe.js";

export interface FakeSttStart {
  onCaption: CaptionHandler;
  onDone: () => void;
  onError: (err: unknown) => void;
  pushed: Buffer[];
  ended: number;
}

/** Records each start() separately so tests can fire callbacks from a replaced (stale) stream. */
export class FakeStt implements Stt {
  starts: FakeSttStart[] = [];
  /** Throws from start() when set, to simulate Transcribe failing synchronously. */
  failStart = false;

  /** Audio pushed across all streams. */
  get pushed(): Buffer[] {
    return this.starts.flatMap((s) => s.pushed);
  }

  /** end() calls across all streams. */
  get ended(): number {
    return this.starts.reduce((n, s) => n + s.ended, 0);
  }

  start(onCaption: CaptionHandler, onDone: () => void, onError: (err: unknown) => void): CaptionStream {
    if (this.failStart) throw new Error("FakeStt: forced start failure");
    const rec: FakeSttStart = { onCaption, onDone, onError, pushed: [], ended: 0 };
    this.starts.push(rec);
    return {
      push: (chunk) => rec.pushed.push(chunk),
      end: () => {
        rec.ended++;
      },
    };
  }
}
