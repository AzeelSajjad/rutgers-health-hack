import { useCallback, useEffect, useRef } from "react";

interface Capture {
  ctx: AudioContext;
  stream: MediaStream;
}

export function useMicPcm() {
  const capture = useRef<Capture | null>(null);

  const startToken = useRef(0);

  const stop = useCallback(() => {
    startToken.current++;
    const cur = capture.current;
    if (!cur) return;
    capture.current = null;
    cur.stream.getTracks().forEach((t) => t.stop());
    void cur.ctx.close();
  }, []);

  // Resolves true once capturing; false if stop()/another start() superseded this one (resources already released).
  const start = useCallback(
    async (onChunk: (pcm: ArrayBuffer) => void): Promise<boolean> => {
      stop();
      const token = ++startToken.current;
      let stream: MediaStream | undefined;
      let ctx: AudioContext | undefined;
      const release = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (ctx) void ctx.close().catch(() => undefined);
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (token !== startToken.current) return release(), false;
        ctx = new AudioContext();
        await ctx.resume();
        if (token !== startToken.current) return release(), false;
        await ctx.audioWorklet.addModule("/pcm-worklet.js");
        if (token !== startToken.current) return release(), false;
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm-capture");
        node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
        // Route through a muted gain so the graph is pulled without echoing the mic to the speakers.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node).connect(mute).connect(ctx.destination);
        capture.current = { ctx, stream };
        return true;
      } catch (err) {
        release();
        throw err;
      }
    },
    [stop],
  );

  useEffect(() => stop, [stop]);
  return { start, stop };
}
