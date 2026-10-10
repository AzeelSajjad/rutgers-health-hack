// Converts mic audio at the AudioContext rate to 16 kHz mono Int16 PCM in ~100 ms frames.
// Nearest-sample decimation is fine for speech recognition.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    while (this.pos < channel.length) {
      const s = Math.max(-1, Math.min(1, channel[Math.floor(this.pos)]));
      this.out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      this.pos += this.ratio;
    }
    this.pos -= channel.length;
    if (this.out.length >= 1600) {
      const pcm = Int16Array.from(this.out);
      this.out = [];
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
