class Recorder extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = []; this.active = true;
    this.port.onmessage = () => { this.active = false; this.flush(); this.port.postMessage({stopped:true}); };
  }
  flush() {
    if (!this.samples.length) return;
    const buffer = new ArrayBuffer(this.samples.length * 2), view = new DataView(buffer);
    this.samples.forEach((v,i) => { v=Math.max(-1,Math.min(1,v)); view.setInt16(i*2, Math.round(v<0?v*32768:v*32767),true); });
    this.samples=[]; this.port.postMessage(buffer,[buffer]);
  }
  process(inputs) {
    if (!this.active) return false;
    const channels=inputs[0];
    if (channels?.length) for (let i=0;i<channels[0].length;i++) {
      let v=0; for (const channel of channels) v+=channel[i]; this.samples.push(v/channels.length);
      if (this.samples.length>=Math.round(sampleRate/10)) this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-recorder',Recorder);
