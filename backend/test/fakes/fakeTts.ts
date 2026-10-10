import type { Tts } from "../../src/speech/polly.js";

export class FakeTts implements Tts {
  calls: { text: string; voiceId: string }[] = [];
  fail = false;

  async synthesize(text: string, voiceId: string): Promise<Buffer> {
    this.calls.push({ text, voiceId });
    if (this.fail) throw new Error("FakeTts: forced failure");
    return Buffer.from(`mp3:${text}`);
  }
}
