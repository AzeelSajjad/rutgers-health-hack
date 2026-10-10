import { describe, it, expect } from "vitest";
import { activeSessionLocks, withSessionLock } from "../src/ws/sessionLock.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withSessionLock", () => {
  it("runs overlapping calls for the same session one after another", async () => {
    const log: string[] = [];
    const gate = deferred();
    const first = withSessionLock("s1", async () => {
      log.push("first:start");
      await gate.promise;
      log.push("first:end");
      return 1;
    });
    const second = withSessionLock("s1", async () => {
      log.push("second:start");
      return 2;
    });
    await tick();
    expect(log).toEqual(["first:start"]);
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(log).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("runs calls for different sessions concurrently", async () => {
    const log: string[] = [];
    const gate = deferred();
    const a = withSessionLock("a", async () => {
      log.push("a:start");
      await gate.promise;
    });
    const b = withSessionLock("b", async () => {
      log.push("b:start");
    });
    await b;
    expect(log).toEqual(["a:start", "b:start"]);
    gate.resolve();
    await a;
  });

  it("a rejection does not break the chain and propagates to its caller", async () => {
    const failed = withSessionLock("s2", async () => {
      throw new Error("boom");
    });
    const next = withSessionLock("s2", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("removes idle entries", async () => {
    await withSessionLock("s3", async () => {});
    await tick();
    expect(activeSessionLocks()).toBe(0);
  });
});
