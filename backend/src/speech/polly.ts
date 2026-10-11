import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from "@aws-sdk/client-polly";

export interface Tts {
  synthesize(text: string, voiceId: string): Promise<Buffer>;
}

export class PollyTts implements Tts {
  private readonly client: PollyClient;

  constructor(region: string) {
    this.client = new PollyClient({ region });
  }

  async synthesize(text: string, voiceId: string): Promise<Buffer> {
    const out = await this.client.send(
      new SynthesizeSpeechCommand({ Engine: "neural", OutputFormat: "mp3", Text: text, VoiceId: voiceId as VoiceId }),
    );
    if (!out.AudioStream) throw new Error("Polly returned no audio");
    return Buffer.from(await out.AudioStream.transformToByteArray());
  }
}
