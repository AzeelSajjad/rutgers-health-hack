import { describe, it, expect } from "vitest";
import type { EncounterState } from "@casecoach/shared";
import { DynamoSessionStore, InMemorySessionStore } from "../src/sessions/sessionStore.js";

const state = (): EncounterState => ({
  sessionId: "s1",
  caseId: "test-case",
  status: "active",
  styleId: "concerned",
  disclosedFactIds: ["a"],
  turns: [],
  createdAt: "2026-10-10T00:00:00.000Z",
});

describe("InMemorySessionStore", () => {
  it("round-trips state", async () => {
    const store = new InMemorySessionStore();
    await store.create(state());
    expect(await store.get("s1")).toEqual(state());
    expect(await store.get("missing")).toBeNull();
  });

  it("returns copies so callers cannot mutate stored state", async () => {
    const store = new InMemorySessionStore();
    await store.create(state());
    const got = (await store.get("s1"))!;
    got.turns.push({ index: 0, speaker: "student", text: "x", at: "t" });
    expect((await store.get("s1"))!.turns).toHaveLength(0);
  });

  it("rejects creating a session id twice", async () => {
    const store = new InMemorySessionStore();
    await store.create(state());
    await expect(store.create(state())).rejects.toThrow();
  });
});

describe("DynamoSessionStore", () => {
  it("reads with ConsistentRead so a resume sees the latest saved turn", async () => {
    const store = new DynamoSessionStore("us-east-1", "sessions");
    const inputs: Record<string, unknown>[] = [];
    (store as unknown as { doc: { send: (c: { input: Record<string, unknown> }) => Promise<unknown> } }).doc = {
      send: async (c) => {
        inputs.push(c.input);
        return { Item: state() };
      },
    };
    expect(await store.get("s1")).toEqual(state());
    expect(inputs[0]).toMatchObject({ TableName: "sessions", Key: { sessionId: "s1" }, ConsistentRead: true });
  });
});
