import workletUrl from './encounter-pcm.ts?worker&url';

export interface MicrophoneCapture { finish(): void; cancel(): void }
/** The encounter engine expects mono PCM at exactly 16 kHz. */
export async function captureMicrophone(onChunk: (chunk: ArrayBuffer) => void, onFinished: () => void, signal: AbortSignal): Promise<MicrophoneCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable. You can type your question instead.');
  let stream: MediaStream | undefined, context: AudioContext | undefined, node: AudioWorkletNode | undefined;
  let closed = false;
  const cancel = () => {
    if (closed) return;
    closed = true; stream?.getTracks().forEach(track => track.stop()); node?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    signal.removeEventListener('abort', cancel);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new Error('Recording cancelled'); }
    context = new AudioContext({ sampleRate: 16000 });
    if (context.sampleRate !== 16000) throw new Error('This browser cannot capture at the required rate. Type your question instead.');
    await context.resume();
    await context.audioWorklet.addModule(workletUrl);
    if (signal.aborted) throw new Error('Recording cancelled');
    node = new AudioWorkletNode(context, 'encounter-pcm');
    node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer | { finished: true }>) => {
      if (closed) return;
      if (data instanceof ArrayBuffer) onChunk(data);
      else { onFinished(); cancel(); }
    };
    const input = context.createMediaStreamSource(stream), mute = context.createGain();
    mute.gain.value = 0; input.connect(node).connect(mute).connect(context.destination);
    return { finish: () => node?.port.postMessage('finish'), cancel };
  } catch (error) { cancel(); throw error; }
}
