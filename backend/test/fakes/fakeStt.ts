import type { CaptionHandler, CaptionStream, Stt } from "../../src/speech/transcribe.js";

export class FakeStt implements Stt {
  pushed: Buffer[] = [];
  ended = 0;
  onCaption?: CaptionHandler;
  onDone?: () => void;
  onError?: (err: unknown) => void;

  start(onCaption: CaptionHandler, onDone: () => void, onError: (err: unknown) => void): CaptionStream {
    this.onCaption = onCaption;
    this.onDone = onDone;
    this.onError = onError;
    return {
      push: (chunk) => this.pushed.push(chunk),
      end: () => {
        this.ended++;
      },
    };
  }
}
