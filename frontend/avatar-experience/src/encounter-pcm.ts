/** Capture 16 kHz mono PCM; flush the last partial frame before caption_stop. */
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof EncounterPcm): void;
class EncounterPcm extends AudioWorkletProcessor {
  private frame: DataView;
  private offset: number;
  private stopped: boolean;
  constructor() {
    super();
    this.frame = new DataView(new ArrayBuffer(3200));
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'finish' && !this.stopped) {
        this.flush(); this.stopped = true; this.port.postMessage({ finished: true });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const bytes = this.frame.buffer.slice(0, this.offset * 2);
    this.port.postMessage(bytes, [bytes]); this.offset = 0;
  }
  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const value of samples) {
      const sample = Math.max(-1, Math.min(1, value));
      this.frame.setInt16(this.offset++ * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      if (this.offset === 1600) this.flush();
    }
    return true;
  }
}
registerProcessor('encounter-pcm', EncounterPcm);
