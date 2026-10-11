/** One server process shares these limits across HTTP requests and WebSocket connections.
 * Multi-instance deployments must inject a distributed implementation of this interface. */
export interface ResourceLimits {
  take(subject: string, operation: 'caption' | 'generation' | 'turn' | 'session'): boolean;
  acquireCaption(subject: string): (() => void) | null;
}
export class LocalResourceLimits implements ResourceLimits {
  private readonly subjects = new Map<string, { active: number; windows: Map<string, number[]>; touched: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  private state(subject: string) {
    const now = this.now();
    for (const [key, state] of this.subjects) if (!state.active && now - state.touched >= 60_000) this.subjects.delete(key);
    let state = this.subjects.get(subject);
    if (!state) {
      // Bound memory even if many distinct verified identities visit the process.
      if (this.subjects.size >= 10_000) return null;
      state = { active: 0, windows: new Map<string, number[]>(), touched: now };
      this.subjects.set(subject, state);
    }
    state.touched = now;
    return state;
  }
  take(subject: string, operation: 'caption' | 'generation' | 'turn' | 'session'): boolean {
    const state = this.state(subject);
    if (!state) return false;
    const now = this.now();
    const starts = (state.windows.get(operation) ?? []).filter(time => now - time < 60_000);
    const maximum = { caption: 6, generation: 6, turn: 30, session: 10 }[operation];
    state.windows.set(operation, starts);
    if (starts.length >= maximum) return false;
    starts.push(now);
    return true;
  }
  acquireCaption(subject: string): (() => void) | null {
    const state = this.state(subject);
    if (!state || state.active >= 1 || !this.take(subject, 'caption')) return null;
    state.active++;
    let released = false;
    return () => { if (!released) { released = true; state.active--; state.touched = this.now(); } };
  }
}
