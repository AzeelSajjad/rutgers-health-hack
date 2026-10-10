import { useCallback, useEffect, useRef } from "react";

interface Capture {
  ctx: AudioContext;
  stream: MediaStream;
}

export function useMicPcm() {
  const capture = useRef<Capture | null>(null);

  const stop = useCallback(() => {
    const cur = capture.current;
    if (!cur) return;
    capture.current = null;
    cur.stream.getTracks().forEach((t) => t.stop());
    void cur.ctx.close();
  }, []);

  const start = useCallback(
    async (onChunk: (pcm: ArrayBuffer) => void) => {
      stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const ctx = new AudioContext();
      await ctx.resume();
      await ctx.audioWorklet.addModule("/pcm-worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
      // Route through a muted gain so the graph is pulled without echoing the mic to the speakers.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(node).connect(mute).connect(ctx.destination);
      capture.current = { ctx, stream };
    },
    [stop],
  );

  useEffect(() => stop, [stop]);
  return { start, stop };
}
