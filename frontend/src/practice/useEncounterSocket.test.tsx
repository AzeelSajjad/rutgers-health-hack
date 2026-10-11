// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncounterSocket } from "./useEncounterSocket";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {}
  receive(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const hook = renderHook(() => useEncounterSocket("morgan-lee"));
  const ws = FakeWebSocket.instances[0]!;
  act(() => ws.onopen?.());
  return { hook, ws };
}

describe("useEncounterSocket caption finalization", () => {
  it("is finalizing after stopCaptions until caption_done", () => {
    const { hook, ws } = setup();
    expect(hook.result.current.isFinalizing()).toBe(false);
    act(() => hook.result.current.startCaptions());
    act(() => hook.result.current.stopCaptions());
    expect(hook.result.current.isFinalizing()).toBe(true);
    act(() => ws.receive({ type: "caption_done" }));
    expect(hook.result.current.isFinalizing()).toBe(false);
  });

  it("clears finalizing when captions restart", () => {
    const { hook } = setup();
    act(() => hook.result.current.stopCaptions());
    expect(hook.result.current.isFinalizing()).toBe(true);
    act(() => hook.result.current.startCaptions());
    expect(hook.result.current.isFinalizing()).toBe(false);
  });

  it("waitForCaptionsDone resolves immediately when not finalizing", async () => {
    vi.useFakeTimers();
    try {
      const { hook } = setup();
      let resolved = false;
      void hook.result.current.waitForCaptionsDone(10_000).then(() => (resolved = true));
      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waitForCaptionsDone waits for caption_done while finalizing", async () => {
    const { hook, ws } = setup();
    act(() => hook.result.current.stopCaptions());
    let resolved = false;
    const p = hook.result.current.waitForCaptionsDone(10_000).then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    act(() => ws.receive({ type: "caption_done" }));
    await p;
    expect(resolved).toBe(true);
  });
});
