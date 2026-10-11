// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { captureMicrophone } from './microphone';
vi.mock('./microphone', () => ({ captureMicrophone: vi.fn() }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0; sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  receive(event: object) { act(() => this.onmessage?.({ data: JSON.stringify(event) })); }
}
class Recognition {
  static instance: Recognition;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.instance = this; }
}
const started = { type: 'session_started', sessionId: 's1', resumed: false,
  patient: { name: 'Wyatt Nelson', age: 18, visitReason: 'Nutrition' },
  transcript: [], disclosedFacts: [], styleLabel: 'Reserved' };
let chunk: (data: ArrayBuffer) => void;
let cancelled: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('scrollTo', vi.fn()); vi.stubGlobal('WebSocket', Socket);
  Object.assign(window, { SpeechRecognition: Recognition });
  Socket.instances = []; cancelled = vi.fn();
  vi.mocked(captureMicrophone).mockImplementation(async onChunk => {
    chunk = onChunk; return { finish: vi.fn(), cancel: cancelled };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function open(preview = true, onExit?: () => void) {
  render(<App previewOnly={preview} onExit={onExit}/>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
  if (!preview) { const socket = Socket.instances[0]!; act(() => socket.onopen?.()); socket.receive(started); return socket; }
}
function question(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: text } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Your question' }).closest('form')!);
}

describe('encounter lifecycle regression coverage', () => {
  it('aborts recognition on exit before returning to the landing screen', () => {
    const exit = vi.fn(); open(true, exit);
    fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(Recognition.instance.abort).toHaveBeenCalled();
    expect(Recognition.instance.onresult).toBeNull();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('locks the composer until recognition ends so final captions cannot overwrite edits', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and review captions' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    act(() => Recognition.instance.onend?.());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('discards pending replies and stale dictation when switching patients', () => {
    open(); question('A question for Wyatt');
    act(() => vi.advanceTimersByTime(650));
    // No speech synthesis in this fixture; the preview is ready again.
    fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    const oldResult = Recognition.instance.onresult!;
    fireEvent.click(screen.getByRole('button', { name: /Practice cases/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Switch patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    act(() => oldResult({ results: [{ isFinal: true, 0: { transcript: 'Old dictation' } }], resultIndex: 0 }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('A question for Wyatt')).toBeNull();
  });

  it('prevents overlapping sends and cancels the pending reply on a patient switch', () => {
    open(); question('First question'); question('Second question');
    expect(within(screen.getByRole('log')).queryByText('Second question')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Practice cases/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Switch patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText('First question')).toBeNull();
    expect(screen.getByRole('log').querySelectorAll('.message')).toHaveLength(1);
  });

  it('keeps sends disabled while backpressure captions finish and ignores later speech events during a turn', async () => {
    const socket = open(false)!;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start microphone' })); });
    socket.bufferedAmount = 192001;
    act(() => chunk(new ArrayBuffer(3200)));
    expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(true);
    socket.receive({ type: 'caption_done' });
    question('Tell me about your diet'); socket.receive({ type: 'patient_thinking' });
    socket.receive({ type: 'caption_done' });
    socket.receive({ type: 'error', message: 'Old speech failure' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    act(() => vi.advanceTimersByTime(90000));
    expect(screen.getByRole('button', { name: 'Reconnect to session' })).toBeTruthy();
  });

  it('preserves a question when resume fails and the learner starts a replacement encounter', () => {
    const socket = open(false)!; question('Do you have any allergies?');
    act(() => socket.onclose?.());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect to session' }));
    Socket.instances[1]!.receive({ type: 'error', code: 'RESUME_FAILED', message: 'Session is gone' });
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    Socket.instances[2]!.receive({ ...started, sessionId: 's2' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Do you have any allergies?');
  });
});
