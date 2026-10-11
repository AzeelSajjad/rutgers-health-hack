// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { captureMicrophone } from './microphone';
vi.mock('./microphone', async importOriginal => ({ ...await importOriginal<typeof import('./microphone')>(), captureMicrophone: vi.fn() }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0; sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) { Socket.instances.push(this); }
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
let cancelled: ReturnType<typeof vi.fn<() => void>>;
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
  render(<App previewOnly={preview} onExit={onExit} getAccessToken={async () => 'test-token'}/>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
  if (!preview) { const socket = Socket.instances[0]!; socket.receive({ type: 'authenticated' }); socket.receive(started); return socket; }
}
function question(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: text } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Your question' }).closest('form')!);
}

describe('encounter lifecycle regression coverage', () => {
  it('explains an immediate browser recognition stop instead of silently resetting', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    act(() => Recognition.instance.onend?.());
    expect(screen.getByText(/The browser stopped speech recognition before hearing speech/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start microphone' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not report an unexpected stop when the user stops recording', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and review captions' }));
    act(() => Recognition.instance.onend?.());
    expect(screen.queryByText(/The browser stopped speech recognition/)).toBeNull();
  });

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
    Socket.instances[1]!.receive({ type: 'authenticated' });
    Socket.instances[1]!.receive({ type: 'error', code: 'RESUME_FAILED', message: 'Session is gone' });
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    Socket.instances[2]!.receive({ type: 'authenticated' });
    Socket.instances[2]!.receive({ ...started, sessionId: 's2' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Do you have any allergies?');
  });
});


describe('integration recovery regressions', () => {
  it.each(['Practice cases', 'Overview'])('stops preview capture when navigating to %s', name => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    const stale = Recognition.instance.onresult!;
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(name) })[0]!);
    expect(Recognition.instance.abort).toHaveBeenCalledTimes(1);
    expect(Recognition.instance.onresult).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Practice cases/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to encounter' }));
    act(() => stale({ results: [{ isFinal: true, 0: { transcript: 'Hidden recording' } }], resultIndex: 0 }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('cancels live audio capture and finalizes the remote caption stream on navigation', async () => {
    const socket = open(false)!;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start microphone' })));
    fireEvent.click(screen.getByRole('button', { name: /Practice cases/ }));
    expect(cancelled).toHaveBeenCalled();
    expect(socket.sent.map(text => JSON.parse(text))).toContainEqual({ type: 'caption_stop' });
  });

  it('clears recovered questions when choosing another patient', () => {
    const socket = open(false)!; question('Wyatt question'); act(() => socket.onclose?.());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect to session' }));
    Socket.instances[1]!.receive({ type: 'authenticated' });
    Socket.instances[1]!.receive({ type: 'error', code: 'RESUME_FAILED', message: 'Session is gone' });
    fireEvent.click(screen.getByRole('button', { name: /Practice cases/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    Socket.instances[2]!.receive({ type: 'authenticated' });
    Socket.instances[2]!.receive({ ...started, sessionId: 'yvette', patient: { name: 'Yvette Armstrong', age: 64, visitReason: 'Nutrition' } });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps a transient resume failure disconnected until a confirmed session resumes', () => {
    const socket = open(false)!; question('Recover me'); act(() => socket.onclose?.());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect to session' }));
    const retry = Socket.instances[1]!;
    retry.receive({ type: 'authenticated' });
    retry.receive({ type: 'error', message: 'Storage temporarily unavailable' });
    expect(screen.getByRole('button', { name: 'Reconnect to session' })).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    question('Should not send');
    expect(retry.sent.some(text => JSON.parse(text).type === 'student_turn')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect to session' }));
    Socket.instances[2]!.receive({ type: 'authenticated' });
    Socket.instances[2]!.receive({ ...started, resumed: true });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(false);
  });
});


describe('authenticated socket handshake', () => {
  it('sends only a token frame until authentication is confirmed', async () => {
    render(<App getAccessToken={async () => 'access-token'}/>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    const socket = Socket.instances[0]!;
    await act(async () => socket.onopen?.());
    expect(socket.url).not.toContain('access-token');
    expect(socket.sent.map(text => JSON.parse(text))).toEqual([{ type: 'authenticate', token: 'access-token' }]);
    socket.receive({ type: 'authenticated' });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'start_session', caseId: '4d619156-3250-4212-8399-129f3280fab1' });
  });

  it('does not start a session when token acquisition fails', async () => {
    render(<App getAccessToken={async () => { throw new Error('expired credentials'); }}/>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    const socket = Socket.instances[0]!;
    await act(async () => socket.onopen?.());
    expect(socket.sent).toEqual([]);
    expect(socket.close).toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).not.toContain('expired credentials');
  });
});


// This coverage exercises the production component after removing the unused practice transport/reducer.
describe('consolidated live encounter behavior', () => {
  it('renders only the facts disclosed by the backend and updates communication style', () => {
    const socket = open(false)!;
    expect(screen.getByLabelText('Disclosed information').textContent).not.toContain('LDL');
    question('What did your test show?');
    socket.receive({ type: 'patient_turn', studentTurn: { index: 0, speaker: 'student', text: 'What did your test show?', at: '2026-10-10' }, patientTurn: { index: 1, speaker: 'patient', text: 'My LDL was 145.', at: '2026-10-10' }, audioBase64: null, styleLabel: 'Engaged', disclosedFacts: [{ id: 'ldl', topic: 'Lab result', content: 'LDL 145' }] });
    expect(screen.getByLabelText('Disclosed information').textContent).toContain('LDL 145');
    expect(screen.getByLabelText('Disclosed information').textContent).toContain('Engaged');
    expect(within(screen.getByRole('log')).getByText('My LDL was 145.')).toBeTruthy();
  });

  it('restores a resumed transcript without duplicating a committed pending question', () => {
    const socket = open(false)!; question('Saved question'); act(() => socket.onclose?.());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect to session' }));
    const retry = Socket.instances[1]!; retry.receive({ type: 'authenticated' });
    retry.receive({ ...started, resumed: true, transcript: [{ index: 0, speaker: 'student', text: 'Saved question', at: '2026-10-10' }] });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(within(screen.getByRole('log')).getAllByText('Saved question')).toHaveLength(1);
  });

  it('restores a question after a turn-scoped failure', () => {
    const socket = open(false)!; question('Try this question');
    socket.receive({ type: 'error', scope: 'turn', message: 'Please retry' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Try this question');
    expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not accept malformed frames and keeps recovery available', () => {
    const socket = open(false)!; socket.receive({ type: 'caption', text: 1, isFinal: true });
    expect(socket.close).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reconnect to session' })).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('refuses a backend session mapped to the wrong patient', () => {
    render(<App getAccessToken={async () => 'test-token'}/>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    const socket = Socket.instances[0]!; socket.receive({ type: 'authenticated' });
    socket.receive({ ...started, patient: { name: 'Other patient', age: 90, visitReason: 'Other case' } });
    expect(socket.close).toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('different patient');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('finalizes and reviews live partial/final captions before enabling sends', async () => {
    const socket = open(false)!;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start microphone' })));
    socket.receive({ type: 'caption', text: 'What brings', isFinal: false });
    expect(screen.getByText('What brings')).toBeTruthy();
    socket.receive({ type: 'caption', text: 'What brings you in?', isFinal: true });
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and review captions' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    socket.receive({ type: 'caption_done' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('What brings you in?');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('cancels a microphone permission request when its controls are hidden', async () => {
    let resolveCapture!: (capture: { finish: () => void; cancel: () => void }) => void;
    vi.mocked(captureMicrophone).mockImplementation(() => new Promise(resolve => { resolveCapture = resolve; }));
    const socket = open(false)!;
    fireEvent.click(screen.getByRole('button', { name: 'Start microphone' }));
    fireEvent.click(screen.getByRole('button', { name: /Practice cases/ }));
    await act(async () => resolveCapture({ finish: vi.fn(), cancel: cancelled }));
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(socket.sent.some(frame => JSON.parse(frame).type === 'caption_start')).toBe(false);
  });

  it('stops sending audio chunks immediately when navigation cancels capture', async () => {
    const socket = open(false)!;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start microphone' })));
    fireEvent.click(screen.getAllByRole('button', { name: 'Overview' })[0]!);
    const sentCount = socket.sent.length;
    act(() => chunk(new ArrayBuffer(3200)));
    expect(socket.sent).toHaveLength(sentCount);
  });

  it('ends the live session only after backend acknowledgement', () => {
    const socket = open(false)!;
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End session' }));
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'end_session' });
    socket.receive({ type: 'session_ended', sessionId: 's1' });
    expect(screen.getByText('Session ended')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});


describe('navigation caption finalization', () => {
  it('holds caption edits until finalization, then ignores late captions after returning', async () => {
    const socket = open(false)!;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start microphone' })));
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and review captions' }));
    fireEvent.click(screen.getByRole('button', { name: /Practice cases/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to encounter' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    socket.receive({ type: 'caption', text: 'Final captured question', isFinal: true });
    socket.receive({ type: 'caption_done' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My corrected question' } });
    socket.receive({ type: 'caption', text: 'Late stale caption', isFinal: true });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My corrected question');
  });
});


describe('retrying encounter finalization', () => {
  it('keeps questions and the microphone disabled after archival fails, then retries ending', () => {
    const socket = open(false)!;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Do not submit while ending' } });
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End session' }));
    socket.receive({ type: 'error', message: 'Transcript archival temporarily unavailable' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Start microphone' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(socket.sent.some(frame => JSON.parse(frame).type === 'student_turn')).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry ending session' }));
    expect(socket.sent.map(frame => JSON.parse(frame)).filter(frame => frame.type === 'end_session')).toHaveLength(2);
    socket.receive({ type: 'session_ended', sessionId: 's1' });
    expect(screen.getByText('Session ended')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});


describe('recovering an interrupted encounter end', () => {
  it.each(['close', 'timeout'])('leaves finalization confirmation to allow reconnect after %s', reason => {
    const socket = open(false)!;
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End session' }));
    if (reason === 'close') act(() => socket.onclose?.());
    else act(() => vi.advanceTimersByTime(15000));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reconnect to session' })).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
  });
});


it('renders the backend chart contract and updates it after fact disclosure without inventing units',()=>{
  const socket=open(false)!;
  const source={source_id:'csv',filename:'faculty-provided-sample-patient-details.csv',patient_uuid:'4d619156-3250-4212-8399-129f3280fab1',field:'notes'};
  const chart={schema_version:1,patient_id:source.patient_uuid,patient_version:1,items:[{item_id:'ldl',label:'LDL cholesterol',category:'labs',value_type:'number',value:145,display_value:'145',unit:null,source_reference:source}]};
  socket.receive({...started,chart});
  expect(screen.getByLabelText('Patient chart').textContent).toContain('145 (unit not supplied)');
  question('Tell me more');
  socket.receive({type:'patient_turn',studentTurn:{index:0,speaker:'student',text:'Tell me more',at:'now'},patientTurn:{index:1,speaker:'patient',text:'Here is another fact',at:'now'},audioBase64:null,styleLabel:'Reserved',disclosedFacts:[],chart:{...chart,items:[...chart.items,{item_id:'diet',label:'Diet preferences',category:'nutrition',value_type:'text',value:'Dislikes vegetables',display_value:'Dislikes vegetables',unit:null,source_reference:source}]}});
  expect(screen.getByLabelText('Patient chart').textContent).toContain('Dislikes vegetables');
});
