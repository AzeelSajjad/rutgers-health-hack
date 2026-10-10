import type { z } from "zod";
import type { ChatMessage, Llm } from "../../src/llm/llm.js";

export class FakeLlm implements Llm {
  jsonQueue: Record<string, unknown[]> = {};
  texts: string[] = [];
  jsonCalls: { purpose: string; system: string; user: string }[] = [];
  textCalls: { purpose: string; system: string; messages: ChatMessage[] }[] = [];
  failOn?: string;

  queueJson(purpose: string, value: unknown): this {
    (this.jsonQueue[purpose] ??= []).push(value);
    return this;
  }

  async json<S extends z.ZodType>(args: { purpose: string; system: string; user: string; schema: S }): Promise<z.infer<S>> {
    this.jsonCalls.push({ purpose: args.purpose, system: args.system, user: args.user });
    if (this.failOn === args.purpose) throw new Error(`FakeLlm: forced failure on ${args.purpose}`);
    const next = this.jsonQueue[args.purpose]?.shift();
    if (next === undefined) throw new Error(`FakeLlm: no json queued for ${args.purpose}`);
    return args.schema.parse(next);
  }

  async text(args: { purpose: string; system: string; messages: ChatMessage[] }): Promise<string> {
    this.textCalls.push(args);
    if (this.failOn === args.purpose) throw new Error(`FakeLlm: forced failure on ${args.purpose}`);
    const next = this.texts.shift();
    if (next === undefined) throw new Error("FakeLlm: no text queued");
    return next;
  }
}
