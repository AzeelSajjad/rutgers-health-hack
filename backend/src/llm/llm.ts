import type { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Llm {
  json<S extends z.ZodType>(args: { purpose: string; system: string; user: string; schema: S }): Promise<z.infer<S>>;
  text(args: { purpose: string; system: string; messages: ChatMessage[] }): Promise<string>;
}

export interface LlmRoles {
  analyzer: Llm;
  patient: Llm;
  validator: Llm;
}

export class LlmError extends Error {}

// Adaptive thinking is on by default for Sonnet 5.5 / Haiku 5.5; thinking tokens count toward max_tokens.
const MAX_TOKENS = 4000;

const refusalDetails = (res: unknown) => JSON.stringify((res as { stop_details?: unknown }).stop_details ?? null);

export class BedrockLlm implements Llm {
  constructor(
    private readonly client: AnthropicBedrockMantle,
    private readonly modelId: string,
  ) {}

  async json<S extends z.ZodType>(args: { purpose: string; system: string; user: string; schema: S }): Promise<z.infer<S>> {
    const res = await this.client.messages.parse({
      model: this.modelId,
      max_tokens: MAX_TOKENS,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      output_config: { effort: "low", format: zodOutputFormat(args.schema) },
    });
    if (res.stop_reason === "refusal") throw new LlmError(`${args.purpose}: model refused ${refusalDetails(res)}`);
    if (res.parsed_output == null) {
      throw new LlmError(`${args.purpose}: no parsable output (stop_reason=${res.stop_reason})`);
    }
    return res.parsed_output as z.infer<S>;
  }

  async text(args: { purpose: string; system: string; messages: ChatMessage[] }): Promise<string> {
    const res = await this.client.messages.create({
      model: this.modelId,
      max_tokens: MAX_TOKENS,
      system: args.system,
      messages: args.messages,
      output_config: { effort: "low" },
    });
    if (res.stop_reason === "refusal") throw new LlmError(`${args.purpose}: model refused ${refusalDetails(res)}`);
    const text = res.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (!text) throw new LlmError(`${args.purpose}: empty response (stop_reason=${res.stop_reason})`);
    return text;
  }
}
