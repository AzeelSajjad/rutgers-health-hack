// Per-session promise chains so two connections on the same session never interleave a read-modify-write.
// Single-process only: a multi-instance deployment would need a conditional write or a distributed lock.
const chains = new Map<string, Promise<void>>();

export function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(sessionId) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  chains.set(sessionId, tail);
  void tail.then(() => {
    if (chains.get(sessionId) === tail) chains.delete(sessionId);
  });
  return run;
}

/** Number of sessions with queued or running work (for tests). */
export const activeSessionLocks = (): number => chains.size;
