import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
const capture = vi.hoisted(() => ({ chunk: null as null | ((chunk: ArrayBuffer) => void), finished: null as null | (() => void) }));
vi.mock('./microphone', () => ({ captureMicrophone: async (chunk: (data: ArrayBuffer) => void, finished: () => void) => {
  capture.chunk = chunk; capture.finished = finished;
  return { finish: () => finished(), cancel: () => {} };
} }));
class Socket {
  static OPEN = 1; static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0; sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() { Socket.instances.push(this); }
  send(value: string | ArrayBuffer) { if (typeof value === 'string') this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.onclose?.(); }
  event(event: Record<string, unknown>) { act(() => this.onmessage?.({ data: JSON.stringify(event) })); }
}
class Recognition {
  static current: Recognition;
  onresult: ((event: unknown) => void) | null = null; onend: (() => void) | null = null;
  constructor() { Recognition.current = this; }
  start() {} stop() {} abort() {}
  final(text: string) { act(() => this.onresult?.({ results: [{ isFinal: true, 0: { transcript: text } }] })); }
}
const question = () => screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement;
const started = (resumed = false, transcript: unknown[] = []) => ({ type: 'session_started', resumed, sessionId: 'session-1', patient: { name: 'Wyatt Nelson', age: 18, visitReason: 'Nutrition' }, transcript, disclosedFacts: [], styleLabel: 'Reserved' });
async function enterLive() {
  render(<App/>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Live AI' }));
  fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
  const socket = Socket.instances.at(-1)!;
  act(() => socket.onopen?.()); socket.event(started()); return socket;
}
async function beginCapture() { await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }))); }
function send(text: string) { fireEvent.change(question(), { target: { value: text } }); fireEvent.click(screen.getByRole('button', { name: 'Send question' })); }
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = []; capture.chunk = null; capture.finished = null;
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('SpeechRecognition', Recognition);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('caption and pending question regressions', () => {
  it('keeps live captions read-only until completion and preserves corrections against late captions', async () => {
    const socket = await enterLive(); await beginCapture();
    socket.event({ type: 'caption', text: 'Are you taking aspirin?', isFinal: true });
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and review captions' }));
    expect(question().readOnly).toBe(true);
    fireEvent.change(question(), { target: { value: 'Are you taking ibuprofen?' } });
    socket.event({ type: 'caption', text: 'every day?', isFinal: true });
    expect(question().value).toBe('Are you taking aspirin? every day?');
    socket.event({ type: 'caption_done' }); expect(question().readOnly).toBe(false);
    fireEvent.change(question(), { target: { value: 'Are you taking ibuprofen every day?' } });
    socket.event({ type: 'caption', text: 'stale caption', isFinal: true });
    expect(question().value).toBe('Are you taking ibuprofen every day?');
  });
  it('uses the same review policy for preview recognition and ignores late recognition results', () => {
    render(<App/>); fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    const recognition = Recognition.current;
    recognition.final('Are you taking aspirin?');
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and review captions' }));
    expect(question().readOnly).toBe(true);
    fireEvent.change(question(), { target: { value: 'Correction before completion' } });
    recognition.final('Are you taking aspirin every day?');
    act(() => recognition.onend?.());
    fireEvent.change(question(), { target: { value: 'Are you taking ibuprofen every day?' } });
    recognition.final('stale recognition');
    expect(question().value).toBe('Are you taking ibuprofen every day?');
  });
  it('backpressure waits for captions, and late speech events cannot release a pending turn or its timeout', async () => {
    const socket = await enterLive(); await beginCapture(); socket.bufferedAmount = 192001;
    act(() => capture.chunk?.(new ArrayBuffer(10)));
    expect(socket.sent.at(-1)?.type).toBe('caption_stop');
    expect(question().readOnly).toBe(true);
    send('Too early'); expect(socket.sent.some(event => event.type === 'student_turn')).toBe(false);
    socket.event({ type: 'caption_done' }); send('What would you like help with?');
    socket.event({ type: 'patient_thinking' });
    socket.event({ type: 'caption_done' }); socket.event({ type: 'error', message: 'Late speech error' });
    expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(90000));
    expect(screen.getByRole('button', { name: 'Reconnect to session' })).toBeTruthy();
    expect(question().value).toBe('What would you like help with?');
  });
  it('keeps a pending question visible through failed resume and carries it into a new encounter', async () => {
    const socket = await enterLive(); send('Could you tell me more?'); act(() => socket.close());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect to session' }));
    expect(question().value).toBe('Could you tell me more?');
    const resumed = Socket.instances.at(-1)!; act(() => resumed.onopen?.());
    resumed.event({ type: 'error', code: 'RESUME_FAILED', message: 'Session not found' });
    expect(question().value).toBe('Could you tell me more?');
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    Socket.instances.at(-1)!.event(started());
    expect(question().value).toBe('Could you tell me more?');
  });
  it('successful resume clears an acknowledged pending question to prevent duplicate sends', async () => {
    const socket = await enterLive(); send('Already saved'); act(() => socket.close());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect to session' }));
    Socket.instances.at(-1)!.event(started(true, [{ index: 0, speaker: 'student', text: 'Already saved', at: 'now' }]));
    expect(question().value).toBe('');
  });
});
