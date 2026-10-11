import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleDot, CirclePlus, LayoutGrid, PanelLeftClose, PanelLeftOpen, Check, ChevronDown, CircleHelp, MessageSquare, Mic, MicOff, MoreHorizontal, Pause, Play, Send, ShieldCheck, Sparkles, Square, Volume2, VolumeX, X } from 'lucide-react';
import type { ChartResponse } from '@casecoach/shared';
import { FacultyReview } from '../review/FacultyReview';
import { RandomPatientCard } from '../library/RandomPatientCard';
import { Avatar } from './Avatar';
import { patients, previewReply, type PatientPresentation } from './patients';
import { appendTurns, parseServerEvent, type ConversationTurn, type DisclosedFact } from './protocol';
import { captureMicrophone, microphoneErrorMessage, type MicrophoneCapture } from './microphone';

type Phase = 'idle' | 'connecting' | 'ready' | 'recording' | 'finishing' | 'thinking' | 'speaking' | 'disconnected' | 'ended';
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
const labels: Record<Phase, string> = { idle: 'Ready when you are', connecting: 'Connecting to your patient…', ready: 'Your patient is listening', recording: 'Listening to you…', finishing: 'Finishing your captions…', thinking: 'Your patient is thinking…', speaking: 'Your patient is speaking', disconnected: 'Connection interrupted', ended: 'Conversation complete' };
const socketUrl = import.meta.env.VITE_ENCOUNTER_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

interface ExperienceProps { accountName?: string; previewOnly?: boolean; onExit?: () => void; getAccessToken?: () => Promise<string> }
export function App({ accountName = 'CaseCoach learner', previewOnly = false, onExit, getAccessToken }: ExperienceProps = {}) {
  const [view, setView] = useState<'overview' | 'cases' | 'encounter' | 'faculty'>('cases');
  const [canReview, setCanReview] = useState(false);
  useEffect(() => {
    if (previewOnly || !getAccessToken) { setCanReview(false); return; }
    const controller = new AbortController();
    void (async () => { try {
      const token = await getAccessToken(); if (controller.signal.aborted) return;
      const response = await fetch('/api/me', {headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
      const identity = await response.json(); if (!controller.signal.aborted) setCanReview(response.ok && identity.role === 'faculty');
    } catch { if (!controller.signal.aborted) setCanReview(false); } })();
    return () => controller.abort();
  }, [getAccessToken, previewOnly]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [patient, setPatient] = useState(patients[0]);
  const [mode, setMode] = useState<'preview' | 'live'>(previewOnly ? 'preview' : 'live');
  const [phase, setPhase] = useState<Phase>('idle');
  const [chart, setChart] = useState<ChartResponse | null>(null);
  const [disclosedFacts, setDisclosedFacts] = useState<DisclosedFact[]>([]);
  const [styleLabel, setStyleLabel] = useState('');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [draft, setDraft] = useState(''), [partial, setPartial] = useState('');
  const [error, setError] = useState(''), [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0), [sessionId, setSessionId] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false), [endOpen, setEndOpen] = useState(false);
  const [confirmPatient, setConfirmPatient] = useState<PatientPresentation | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [ending, setEnding] = useState(false);
  const endingRef = useRef(false);
  const markEnding = (value: boolean) => { endingRef.current = value; setEnding(value); };
  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);
  const ws = useRef<WebSocket | null>(null), generation = useRef(0), mic = useRef<MicrophoneCapture | null>(null);
  const abortMic = useRef<AbortController | null>(null), recognition = useRef<Recognition | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), audioUrl = useRef<string | null>(null);
  const clockStart = useRef<number | null>(null), pendingText = useRef(''), finals = useRef('');
  const pendingIndex = useRef<number | null>(null);
  const captionState = useRef<'idle' | 'recording' | 'finishing'>('idle'), turnPending = useRef(false);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveredDraft = useRef<{ caseId: string; text: string } | null>(null), draftRef = useRef(draft);
  const viewRef = useRef(view); viewRef.current = view;
  draftRef.current = draft;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(muted), phaseRef = useRef(phase), sessionRef = useRef(sessionId);
  const historyBottom = useRef<HTMLDivElement | null>(null), composer = useRef<HTMLTextAreaElement | null>(null);
  mutedRef.current = muted; phaseRef.current = phase; sessionRef.current = sessionId;
  useEffect(() => {
    if (!helpOpen && !endOpen && !confirmPatient) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const targets = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]') ?? []);
    targets()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (phaseRef.current !== 'connecting' && !endingRef.current) { setHelpOpen(false); setEndOpen(false); setConfirmPatient(null); } }
      if (event.key !== 'Tab') return;
      const all = targets(), first = all[0], last = all.at(-1);
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [helpOpen, endOpen, confirmPatient]);
  const clearWait = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const stopAudio = () => {
    if (audio.current) { audio.current.onplay = null; audio.current.onended = null; audio.current.onerror = null; }
    audio.current?.pause(); window.speechSynthesis?.cancel(); setAudioReady(false);
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null; audio.current = null;
  };
  const clearCaptionWait = () => { if (captionTimer.current) clearTimeout(captionTimer.current); captionTimer.current = null; };
  const stopMic = () => {
    captionState.current = 'idle'; clearCaptionWait();
    abortMic.current?.abort(); abortMic.current = null; mic.current?.cancel(); mic.current = null;
    const r = recognition.current; recognition.current = null;
    if (r) { r.onresult = null; r.onend = null; r.onerror = null; r.abort(); }
    setPartial('');
  };
  const cleanup = () => {
    generation.current++; clearWait(); turnPending.current = false; if (previewTimer.current) clearTimeout(previewTimer.current);
    stopMic(); stopAudio(); ws.current?.close(); ws.current = null;
  };
  useEffect(() => () => {
    generation.current++; if (captionTimer.current) clearTimeout(captionTimer.current); if (timer.current) clearTimeout(timer.current); if (previewTimer.current) clearTimeout(previewTimer.current);
    abortMic.current?.abort(); mic.current?.cancel();
    if (recognition.current) { recognition.current.onresult = null; recognition.current.onend = null; recognition.current.onerror = null; recognition.current.abort(); }
    ws.current?.close();
    audio.current?.pause(); window.speechSynthesis?.cancel(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
  }, []);
  useEffect(() => { historyBottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [turns, phase]);
  useEffect(() => {
    const id = setInterval(() => { if (clockStart.current && sessionRef.current && phaseRef.current !== 'ended') setElapsed(Math.floor((Date.now() - clockStart.current) / 1000)); }, 1000);
    return () => clearInterval(id);
  }, []);
  const waitFor = (message: string, milliseconds = 15000) => {
    clearWait(); timer.current = setTimeout(() => {
      stopMic(); setError(message); if (endingRef.current) setEndOpen(false);
      if (pendingText.current) setDraft(pendingText.current);
      const socket = ws.current; ws.current = null; generation.current++; socket?.close();
      setPhase(sessionRef.current ? 'disconnected' : 'idle');
    }, milliseconds);
  };
  const waitForCaptions = () => {
    if (captionState.current === 'idle') return;
    clearCaptionWait(); captionTimer.current = setTimeout(() => {
      stopMic(); clearWait(); stopAudio(); generation.current++; ws.current?.close(); ws.current = null;
      if (pendingText.current) setDraft(pendingText.current);
      setError('Captions did not finish. Your text is preserved; reconnect before continuing.');
      setPhase(sessionRef.current ? 'disconnected' : 'idle');
    }, 15000);
  };
  const speakPreview = (text: string) => {
    if (viewRef.current !== 'encounter' || mutedRef.current || !window.speechSynthesis) { setPhase('ready'); return; }
    const gen = generation.current, utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = .92;
    utterance.onstart = () => { if (gen === generation.current) setPhase('speaking'); };
    utterance.onend = utterance.onerror = () => { if (gen === generation.current) setPhase('ready'); };
    window.speechSynthesis.speak(utterance);
  };
  const playLiveAudio = async (base64: string | null) => {
    stopAudio();
    if (viewRef.current !== 'encounter' || !base64 || mutedRef.current) { setPhase('ready'); return; }
    try {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })); audioUrl.current = url;
      const player = new Audio(url), gen = generation.current; audio.current = player; setAudioReady(true);
      player.onplay = () => { if (generation.current === gen) setPhase('speaking'); };
      player.onended = () => { if (generation.current === gen) { setPhase('ready'); setAudioReady(false); } URL.revokeObjectURL(url); if (audioUrl.current === url) audioUrl.current = null; };
      player.onerror = () => { if (generation.current === gen) { setPhase('ready'); setError('Patient audio could not play. The reply is available in the conversation.'); setAudioReady(false); } };
      await player.play().catch(() => { if (generation.current === gen) setPhase('ready'); });
    } catch { setPhase('ready'); setError('Patient audio was unavailable. You can read the reply.'); }
  };
  const start = (resume = false) => {
    const retainedDraft = resume ? pendingText.current || draftRef.current : recoveredDraft.current?.caseId === patient.caseId ? recoveredDraft.current.text : '';
    cleanup(); setError(''); setDraft(retainedDraft); setPartial(''); setEndOpen(false);
    recoveredDraft.current = null;
    if (!resume) { markEnding(false); pendingText.current = ''; pendingIndex.current = null; setTurns([]); setChart(null); setDisclosedFacts([]); setStyleLabel(''); setSessionId(null); clockStart.current = null; setElapsed(0); }
    if (mode === 'preview') {
      setSessionId(`preview-${crypto.randomUUID()}`); clockStart.current = Date.now();
      setTurns([{ index: 0, speaker: 'patient', text: patient.previewOpening, at: new Date().toISOString() }]);
      setPhase('ready'); return;
    }
    setPhase('connecting'); const gen = generation.current; let socket: WebSocket;
    let authenticated = false, confirmed = false;
    try { socket = new WebSocket(socketUrl); } catch { setError('The encounter server URL is invalid. Check the app configuration.'); setPhase('idle'); return; }
    ws.current = socket;
    waitFor('The patient server did not respond. Start the encounter backend, then try again.');
    const disconnect = (message: string) => {
      clearWait(); stopMic(); stopAudio(); setError(message); if (endingRef.current) setEndOpen(false);
      generation.current++; socket.close(); if (ws.current === socket) ws.current = null;
      setPhase(sessionRef.current ? 'disconnected' : 'idle');
    };
    socket.onopen = async () => {
      try {
        if (!getAccessToken) throw new Error('No identity provider');
        const token = await getAccessToken();
        if (gen !== generation.current || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'authenticate', token }));
      } catch {
        if (gen === generation.current) disconnect('Could not authenticate this encounter. Sign in again, then retry.');
      }
    };
    socket.onmessage = ({ data }) => {
      if (gen !== generation.current) return;
      try {
        const event = parseServerEvent(String(data));
        if (event.type === 'authenticated') {
          if (authenticated) return;
          authenticated = true;
          socket.send(JSON.stringify(resume && sessionRef.current ? { type: 'resume_session', sessionId: sessionRef.current } : { type: 'start_session', caseId: patient.caseId }));
          return;
        }
        if (event.type !== 'error' && !authenticated) { disconnect('The server did not authenticate this encounter. Sign in again, then retry.'); return; }
        if ('chart' in event && event.chart && event.chart.patient_id !== patient.caseId) { disconnect('The server returned a chart for a different patient. Choose your patient again.'); return; }
        if (event.type !== 'error' && event.type !== 'session_started' && !confirmed) return;
        switch (event.type) {
          case 'session_started':
            confirmed = true; markEnding(false);
            clearWait();
            if (event.patient.name !== patient.name || event.patient.age !== patient.age) {
              socket.send(JSON.stringify({ type: 'end_session' })); generation.current++; socket.close(); ws.current = null;
              setError('The backend returned a different patient. Check the selected case mapping before continuing.'); setPhase('idle'); return;
            }
            setSessionId(event.sessionId); sessionRef.current = event.sessionId;
            clockStart.current ??= Date.now(); setTurns(event.transcript); setChart(event.chart ?? null); setDisclosedFacts(event.disclosedFacts); setStyleLabel(event.styleLabel);
            if (pendingText.current) {
              const committed = event.transcript.some(turn => turn.index === pendingIndex.current && turn.speaker === 'student' && turn.text === pendingText.current);
              setDraft(committed ? '' : pendingText.current); pendingText.current = ''; pendingIndex.current = null;
            }
            setPhase('ready'); break;
          case 'patient_thinking': if (turnPending.current) setPhase('thinking'); break;
          case 'patient_turn':
            clearWait(); turnPending.current = false; setChart(event.chart ?? null); setDisclosedFacts(event.disclosedFacts); setStyleLabel(event.styleLabel); setTurns(current => appendTurns(current, [event.studentTurn, event.patientTurn])); pendingText.current = ''; pendingIndex.current = null;
            void playLiveAudio(event.audioBase64); break;
          case 'caption':
            if (captionState.current === 'idle' || turnPending.current) break;
            if (event.isFinal) { finals.current = `${finals.current} ${event.text}`.trim(); setDraft(finals.current); setPartial(''); }
            else setPartial(event.text); break;
          case 'caption_done':
            if (captionState.current === 'idle' || turnPending.current) break;
            stopMic(); setPhase('ready'); composer.current?.focus(); break;
          case 'session_ended': markEnding(false); clearWait(); setError(''); stopMic(); stopAudio(); setPhase('ended'); setEndOpen(false); break;
          case 'error':
            setError(event.message);
            if (event.code === 'RESUME_FAILED') {
              clearWait(); stopMic(); turnPending.current = false;
              recoveredDraft.current = { caseId: patient.caseId, text: pendingText.current || draftRef.current };
              setDraft(recoveredDraft.current.text); setSessionId(null); sessionRef.current = null;
              disconnect(event.message);
            } else if (!confirmed || event.code?.startsWith('AUTH_')) disconnect(event.message);
            else if (event.scope === 'turn') {
              if (turnPending.current) { clearWait(); turnPending.current = false; setDraft(pendingText.current); pendingText.current = ''; pendingIndex.current = null; setPhase(sessionRef.current ? 'ready' : 'idle'); }
            } else if (captionState.current !== 'idle') {
              stopMic(); if (!turnPending.current) setPhase(sessionRef.current ? 'ready' : 'idle');
            } else if (!turnPending.current && endingRef.current) { clearWait(); setPhase('ready'); }

            break;
        }
      } catch { clearWait(); stopMic(); if (endingRef.current) setEndOpen(false); setError('The server sent an unexpected response. Reconnect before continuing.'); generation.current++; socket.close(); ws.current = null; setPhase(sessionRef.current ? 'disconnected' : 'idle'); }
    };
    socket.onclose = () => {
      if (gen !== generation.current || phaseRef.current === 'ended') return;
      clearWait(); stopMic(); stopAudio(); if (endingRef.current) setEndOpen(false); if (pendingText.current) setDraft(pendingText.current);
      setPhase(sessionRef.current ? 'disconnected' : 'idle'); setError('Connection closed. Reconnect to recover the session before sending another question.');
    };
    socket.onerror = () => { if (gen === generation.current) setError('Could not connect to the encounter backend. Preview mode is available while it is being integrated.'); };
  };
  const send = () => {
    const text = draftRef.current.trim(); if (!text || phaseRef.current !== 'ready' || captionState.current !== 'idle' || turnPending.current || endingRef.current || text.length > 1000) return;
    phaseRef.current = 'thinking'; stopAudio(); setError(''); setDraft(''); turnPending.current = true; pendingText.current = text; pendingIndex.current = (turns.at(-1)?.index ?? -1) + 1; setPhase('thinking');
    if (mode === 'live') {
      if (ws.current?.readyState !== WebSocket.OPEN) { setDraft(text); setPhase('disconnected'); return; }
      ws.current.send(JSON.stringify({ type: 'student_turn', text }));
      waitFor('The reply took too long. Reconnect to check whether your turn was saved before retrying.', 90000); return;
    }
    const gen = generation.current;
    previewTimer.current = setTimeout(() => {
      if (gen !== generation.current) return;
      const reply = previewReply(patient, text), at = new Date().toISOString();
      setTurns(current => [...current, { index: current.length, speaker: 'student', text, at }, { index: current.length + 1, speaker: 'patient', text: reply, at }]);
      pendingText.current = ''; turnPending.current = false; speakPreview(reply);
    }, 650);
  };
  const record = async () => {
    if (endingRef.current) return;
    if (phase === 'recording') {
      captionState.current = 'finishing'; setPhase('finishing');
      if (mode === 'live') { mic.current?.finish(); waitForCaptions(); }
      else { recognition.current?.stop(); waitForCaptions(); } return;
    }
    if (phase !== 'ready') return;
    stopAudio(); setError(''); finals.current = draft; setPartial(''); setPhase(mode === 'live' ? 'connecting' : 'recording');
    if (mode === 'preview') {
      const win = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
      const Constructor = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (!Constructor) { setError('Voice preview is unavailable in this browser. Type your question, or use the live backend microphone.'); setPhase('ready'); return; }
      captionState.current = 'recording';
      const r = new Constructor(), gen = generation.current, initialDraft = draft; recognition.current = r;
      r.lang = 'en-US'; r.interimResults = true; r.continuous = true;
      r.onresult = event => {
        if (gen !== generation.current || captionState.current === 'idle' || recognition.current !== r) return;
        let finalText = '', partialText = '';
        for (let i = 0; i < event.results.length; i++) { const result = event.results[i]; if (result.isFinal) finalText += ` ${result[0].transcript}`; else partialText += ` ${result[0].transcript}`; }
        setDraft(`${initialDraft} ${finalText}`.trim()); setPartial(partialText.trim());
      };
      r.onend = () => { if (gen === generation.current && recognition.current === r) { captionState.current = 'idle'; clearCaptionWait(); setPartial(''); setPhase('ready'); recognition.current = null; composer.current?.focus(); } };
      r.onerror = event => { if (gen === generation.current && recognition.current === r) { stopMic(); setError(event.error === 'not-allowed' ? 'Microphone permission was denied. You can type instead.' : 'Voice preview stopped. Review any captions or type your question.'); setPhase('ready'); } };
      try { r.start(); } catch { stopMic(); setPhase('ready'); setError('The microphone could not start. Type your question instead.'); }
      return;
    }
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) { setPhase('disconnected'); return; }
    const controller = new AbortController(); abortMic.current = controller;
    const gen = generation.current;
    try {
      // Capture readiness comes first so denied permissions do not start a remote STT stream.
      let ready = false;
      const capture = await captureMicrophone(chunk => {
        if (!ready || gen !== generation.current || controller.signal.aborted) return;
        if (socket.bufferedAmount > 192000) {
          ready = false; controller.abort(); captionState.current = 'finishing';
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'caption_stop' }));
          setError('Audio connection is too slow. Finishing captions before you can edit or send.'); phaseRef.current = 'finishing'; setPhase('finishing'); waitForCaptions(); return;
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
      }, () => { if (gen === generation.current && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'caption_stop' })); }, controller.signal);
      if (gen !== generation.current || controller.signal.aborted) { capture.cancel(); return; }
      mic.current = capture; captionState.current = 'recording'; socket.send(JSON.stringify({ type: 'caption_start' })); ready = true; setPhase('recording');
    } catch (error) { if (gen === generation.current) { setPhase('ready'); setError(microphoneErrorMessage(error)); } }
  };
  const finish = () => {
    if (phase !== 'ready' && phase !== 'speaking') return;
    setError(''); stopAudio(); stopMic();
    if (mode === 'preview') { setPhase('ended'); setEndOpen(false); return; }
    if (ws.current?.readyState !== WebSocket.OPEN) { setError('Reconnect before ending this session.'); setEndOpen(false); return; }
    markEnding(true); ws.current.send(JSON.stringify({ type: 'end_session' })); setPhase('connecting'); waitFor('The server did not confirm the session ended. Reconnect to check its state.');
  };
  const resetRecovery = () => { recoveredDraft.current = null; pendingText.current = ''; pendingIndex.current = null; finals.current = ''; setChart(null); setDisclosedFacts([]); setStyleLabel(''); };
  const changePatient = (next: PatientPresentation) => {
    if (next.key === patient.key) { setPickOpen(false); return; }
    if (sessionId && phase !== 'ended') { setConfirmPatient(next); setPickOpen(false); return; }
    cleanup(); resetRecovery(); setPatient(next); setTurns([]); setSessionId(null); sessionRef.current = null; setElapsed(0); setDraft(''); setError(''); setPhase('idle'); setPickOpen(false);
  };
  const switchConfirmed = () => {
    if (!confirmPatient) return;
    // Keep an active backend encounter intact rather than silently abandoning it.
    if (mode === 'live' && sessionId && phase !== 'ended') { setError('End the current encounter first, then choose the other patient.'); setConfirmPatient(null); setEndOpen(true); return; }
    const next = confirmPatient; setConfirmPatient(null); cleanup(); resetRecovery(); setPatient(next); setTurns([]); setSessionId(null); sessionRef.current = null; setElapsed(0); setDraft(''); setError(''); setPhase('idle');
  };
  const active = sessionId !== null && phase !== 'ended';
  const canCompose = phase === 'ready' && !ending, busy = ['connecting', 'thinking', 'finishing'].includes(phase);
  const formattedTime = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const openPatient = (next: PatientPresentation) => { changePatient(next); setView('encounter'); };
  const navigate = (next: 'overview' | 'cases' | 'faculty') => {
    if (viewRef.current === 'encounter') {
      const capturing = phaseRef.current === 'recording' || phaseRef.current === 'finishing' || abortMic.current !== null;
      const hadRemoteCaptions = mic.current !== null || phaseRef.current === 'finishing';
      stopMic(); stopAudio();
      if (capturing) {
        if (mode === 'live' && hadRemoteCaptions && ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'caption_stop' }));
          captionState.current = 'finishing'; phaseRef.current = 'finishing'; setPhase('finishing');
          waitForCaptions();
        } else { phaseRef.current = 'ready'; setPhase('ready'); }
      } else if (phaseRef.current === 'speaking') setPhase('ready');
    }
    setPickOpen(false); viewRef.current = next; setView(next);
  };
  const browseCases = () => navigate('cases');
  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="learning-sidebar" aria-label="Learning space">
      <a className="sidebar-brand" href="#overview" onClick={e => { e.preventDefault(); navigate('overview'); }}><span className="logo-mark"><CirclePlus size={28}/></span><span><strong>casecoach<span>.</span></strong><small>CLINICAL PRACTICE</small></span></a>
      <div className="sidebar-label">LEARNING SPACE</div>
      <div className="course-card"><span className="course-icon"><Sparkles size={25}/></span><span><strong>Clinical interview practice</strong><small>HealthHack · Educational demo</small></span></div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <button className={view === 'overview' ? 'selected' : ''} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => navigate('overview')}><LayoutGrid size={20}/><span>Overview</span></button>
        <button className={view === 'cases' || view === 'encounter' ? 'selected' : ''} aria-current={view === 'cases' || view === 'encounter' ? 'page' : undefined} onClick={browseCases}><CircleDot size={22}/><span>Practice cases</span><span className="nav-count">2</span></button>
        <button onClick={() => setHelpOpen(true)}><CircleHelp size={21}/><span>How to practice</span></button>
        {canReview && <button className={view === "faculty" ? "selected" : ""} aria-current={view === "faculty" ? "page" : undefined} onClick={() => navigate("faculty")}><ShieldCheck size={21}/><span>Faculty review</span></button>}
      </nav>
      <p className="sidebar-note">A little practice.<br/>A better conversation.</p>
    </aside>
    <div className="main-space">
    <header className="topbar"><button className="sidebar-toggle" aria-label="Toggle learning sidebar" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={20}/> : <PanelLeftClose size={20}/>}</button><nav className="top-nav" aria-label="Workspace navigation"><button className={view === 'overview' ? 'selected' : ''} onClick={() => navigate('overview')}>Overview</button><button className={view !== 'overview' ? 'selected' : ''} onClick={browseCases}>Practice</button></nav><div className="top-right"><span className={`mode-pill ${mode}`}><span/>{mode === 'preview' ? 'Scripted preview' : 'Live encounter'}</span><button className="icon-button" onClick={() => setHelpOpen(true)} aria-label="How this experience works"><CircleHelp size={21}/></button><div className="account-controls"><span className="account-name">{accountName}</span>{onExit && <button className="account-exit" onClick={() => { cleanup(); onExit(); }}>{previewOnly ? 'Exit preview' : 'Sign out'}</button>}</div></div></header>
    <main className="workspace">
      <div className="page-heading"><div><div className="eyebrow"><span/>{view === 'overview' ? 'YOUR LEARNING SPACE' : view === 'cases' ? 'PRACTICE CASES' : view === 'faculty' ? 'FACULTY WORKSPACE' : 'PATIENT CONVERSATION'}</div><h1>{view === 'overview' ? 'Overview' : view === 'cases' ? 'Choose a patient' : view === 'faculty' ? 'Review clinical sessions' : 'Make space for their story.'}</h1><p>{view === 'overview' ? 'A space to build confidence in your clinical conversations.' : view === 'cases' ? 'Each simulated patient brings a different clinical focus and communication style.' : view === 'faculty' ? 'Review student conversations and plan your follow-up.' : 'Listen with curiosity. Ask with care. Take it one question at a time.'}</p></div>{view === 'encounter' ? <div className="session-tools"><div className="mode-select" aria-label="Experience mode"><button aria-pressed={mode === 'preview'} disabled={active || patient.key.startsWith('random-')} onClick={() => { cleanup(); setMode('preview'); setPhase('idle'); setError(''); }}>Preview</button><button aria-pressed={mode === 'live'} disabled={active || previewOnly} title={previewOnly ? 'Sign in to use live encounters' : undefined} onClick={() => { cleanup(); setMode('live'); setPhase('idle'); setError(''); }}>Live AI</button></div></div> : view === 'overview' ? <button className="primary-button" onClick={browseCases}>Browse practice cases <ArrowRight size={18}/></button> : view === 'cases' ? <div className="case-count"><CircleDot size={23}/><span><strong>2 cases</strong><small>Available to practice</small></span></div> : null}</div>
      {view === 'overview' && <div className="overview-grid"><section className="overview-card"><div className="eyebrow">A GENTLE PLACE TO BEGIN</div><h2>Choose a case to begin</h2><p>Practice a focused interview with a virtual patient. Speak or type, review your words, and listen to their reply.</p><button className="text-link" onClick={browseCases}>Choose a patient <ArrowRight size={16}/></button></section><section className="overview-card"><div className="eyebrow">YOUR PRACTICE EXPERIENCE</div><h2>Two perspectives. Room to listen.</h2><p>Meet Wyatt and Yvette. Start with scripted preview, or connect to the encounter backend for live AI.</p><button className="text-link" onClick={() => setHelpOpen(true)}>How it works <ArrowRight size={16}/></button></section></div>}
      {view === 'faculty' && canReview && getAccessToken && <FacultyReview getAccessToken={getAccessToken}/>}
      {view === 'cases' && <><div className="patient-cards">{patients.map((p, i) => <article className="patient-card" key={p.key}><div className="case-card-top"><span className={`patient-initials ${p.key}`}>{p.initials}</span><span>CASE {String(i + 1).padStart(2, '0')}</span></div><h2>{p.name}</h2><p className="case-summary">{p.subtitle}</p><div className="case-details"><span className="detail-label">PRACTICE FOCUS</span><strong>{p.visit}</strong><span className="detail-label">PATIENT</span><strong>{p.age} years</strong><span className="detail-label">CONVERSATION APPROACH</span><p>Listen with curiosity. Take it one question at a time.</p></div><button className="case-start" onClick={() => openPatient(p)}>{active && patient.key === p.key ? 'Return to encounter' : 'Start encounter'}<ArrowRight size={18}/></button></article>)}{!previewOnly && <RandomPatientCard getAccessToken={getAccessToken} disabled={active} onCreated={p => { changePatient(p); setMode('live'); setView('encounter'); }}/>}</div><p className="case-disclaimer"><CircleHelp size={17}/>Patient details follow the provided sample cases. Avatar illustrations and dialogue are authored simulation choices.</p></>}
      <div hidden={view !== 'encounter'}>
      <div className="encounter-layout">
        <section className="encounter-panel" aria-label="Patient encounter">
          <div className="encounter-header"><div className="patient-picker"><button className="patient-trigger" aria-expanded={pickOpen} onClick={() => setPickOpen(!pickOpen)} disabled={busy || phase === 'recording'}><div className={`mini-avatar ${patient.key}`}><Avatar patient={patient} small/></div><span><strong>{patient.name}</strong><span>{patient.age} years · {patient.visit}</span></span><ChevronDown size={16}/></button>{pickOpen && <div className="patient-menu">{patients.map(p => <button key={p.key} onClick={() => changePatient(p)}><div className={`mini-avatar ${p.key}`}><Avatar patient={p} small/></div><span><strong>{p.name}</strong><span>{p.age} years · Sample patient</span></span>{p.key === patient.key && <Check size={16}/>}</button>)}</div>}</div><div className="encounter-meta"><span className="timer-dot"/>{formattedTime}<span className="meta-divider"/><span>Practice session</span><button className="icon-button" aria-label="Session information" onClick={() => setHelpOpen(true)}><MoreHorizontal size={20}/></button></div></div>
          <div className={`avatar-stage ${patient.key} ${phase}`}><div className="stage-grid"/><div className="stage-label"><span/>Virtual patient · Educational simulation</div><div className="portrait-halo"/><div className="avatar-position"><Avatar patient={patient} speaking={phase === 'speaking'}/></div><div className="avatar-name"><span>{patient.name.split(' ')[0]}</span><span>{patient.subtitle}</span></div><div className="stage-bottom"><div className={`connection-tag ${phase}`}><span/>{phase === 'idle' ? 'Ready to meet you' : phase === 'ended' ? 'Session ended' : phase === 'disconnected' ? 'Connection offline' : phase === 'connecting' ? 'Connecting…' : mode === 'preview' ? 'Preview conversation' : 'Connected to encounter'}</div><span>Illustrated avatar</span></div>
          {phase === 'ended' && <div className="end-overlay"><span className="complete-mark"><Check size={28}/></span><h2>A conversation worth practicing.</h2><p>{turns.filter(turn => turn.speaker === 'student').length} {turns.filter(turn => turn.speaker === 'student').length === 1 ? 'question' : 'questions'} · {formattedTime}<br/>{mode === 'preview' ? 'Preview complete. No transcript was uploaded.' : 'Encounter ended. Your backend controls transcript storage.'}</p><button className="primary-button" onClick={() => start(false)}>Practice again <ArrowRight size={17}/></button></div>}</div>
          <div className="conversation-control"><div className="status-line" role="status"><span className={`status-dot ${phase}`}/>{ending && phase === 'ready' ? 'The session could not finish. Retry ending the session.' : ending && phase === 'connecting' ? 'Saving your conversation…' : labels[phase]}</div>{partial && <p className="live-caption" aria-live="polite">{partial}</p>}
            {phase === 'idle' ? <div className="start-area"><button className="primary-button" onClick={() => start()}>Begin conversation<ArrowRight size={17}/></button><span>{mode === 'preview' ? 'Try the flow with scripted replies' : 'Connect to the patient AI and voice backend'}</span></div> : phase === 'ended' ? <p className="control-hint">Choose another patient or practice this conversation again.</p> : phase === 'disconnected' ? <button className="primary-button" onClick={() => start(true)}>Reconnect to session <ArrowRight size={17}/></button> : <><div className="voice-controls"><button className="round-button" onClick={() => { stopAudio(); if (phase === 'speaking') setPhase('ready'); setMuted(!muted); }} aria-label={muted ? 'Enable patient audio' : 'Mute patient audio'}>{muted ? <VolumeX size={20}/> : <Volume2 size={20}/>}</button><div className="microphone-wrap"><button className={`microphone-button ${phase === 'recording' ? 'is-recording' : ''}`} disabled={ending || (phase !== 'ready' && phase !== 'recording')} onClick={() => void record()} aria-label={phase === 'recording' ? 'Stop recording and review captions' : 'Start microphone'}>{phase === 'recording' ? <Square size={22} fill="currentColor"/> : <Mic size={26}/>}</button><span>{phase === 'recording' ? 'Stop & review' : busy ? 'Just a moment' : 'Tap to speak'}</span></div><button className="round-button" disabled={!audioReady && phase !== 'speaking'} onClick={() => { if (phase === 'speaking') { audio.current?.pause(); window.speechSynthesis?.cancel(); setPhase('ready'); } else void audio.current?.play().catch(() => setError('Your browser could not play this audio.')); }} aria-label={phase === 'speaking' ? 'Pause patient audio' : 'Play patient reply'}>{phase === 'speaking' ? <Pause size={20}/> : <Play size={20}/>}</button></div><p className="control-hint">{phase === 'recording' || phase === 'finishing' ? 'Captions are being collected. You can edit them when recording finishes.' : 'Review your words below before sending.'}</p></>}
            {error && <div className="error-message" role="alert">{error}<button aria-label="Dismiss message" onClick={() => setError('')}><X size={14}/></button></div>}
            {(active || draft) && <form className="composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea ref={composer} aria-label="Your question" placeholder="Or type your question here…" value={draft} maxLength={1000} readOnly={!canCompose} aria-readonly={!canCompose} onChange={event => { if (canCompose) setDraft(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}/><button aria-label="Send question" type="submit" disabled={!canCompose || !draft.trim()}><Send size={18}/></button></form>}
            <div className="control-footer"><span><ShieldCheck size={14}/>A space to practice, not a clinical consultation.</span>{active && <button onClick={() => setEndOpen(true)} disabled={phase !== 'ready' && phase !== 'speaking'}>End session <ArrowRight size={13}/></button>}</div>
          </div>
        </section>
        <aside className="conversation-panel"><div className="aside-header"><div><MessageSquare size={18}/><h2>Conversation</h2></div><span>{turns.length ? `${turns.length} ${turns.length === 1 ? 'message' : 'messages'}` : 'Live captions'}</span></div><div className="transcript" aria-label="Conversation transcript" role="log" aria-live="polite">{turns.length === 0 ? <div className="empty-conversation"><div className="empty-icon"><MessageSquare size={23}/></div><h3>Every good conversation <br/>starts with listening.</h3><p>Your conversation with {patient.name.split(' ')[0]} will appear here as you go.</p><div className="conversation-dots"><span/><span/><span/></div></div> : turns.map(turn => <div className={`message ${turn.speaker}`} key={`${sessionId}-${turn.index}`}><div className="message-label">{turn.speaker === 'patient' ? patient.name.split(' ')[0] : 'You'}<span>{new Date(turn.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="message-body">{turn.text}</div></div>)}{phase === 'thinking' && <div className="thinking-bubble" aria-label="Patient is thinking"><span/><span/><span/></div>}<div ref={historyBottom}/></div><div className="starter-card"><div className="starter-title"><Sparkles size={16}/><span>A gentle place to start</span></div><p>Open questions make room for the patient's perspective.</p><button disabled={!canCompose} onClick={() => { setDraft(patient.prompts[0]); composer.current?.focus(); }}>“{patient.prompts[0]}”<ArrowRight size={14}/></button></div><section className="disclosed-information" aria-label="Disclosed information"><h3>Disclosed information</h3>{chart && chart.patient_id === patient.caseId && chart.items.length > 0 && <section aria-label="Patient chart"><h4>Patient chart</h4><dl>{chart.items.map(item => <div className="chart-item" key={item.item_id}><dt>{item.label}</dt><dd>{item.display_value}{item.unit ? ` ${item.unit}` : item.value_type === "number" ? " (unit not supplied)" : ""}</dd><small>{item.category} · {item.source_reference.filename}</small></div>)}</dl></section>}{styleLabel && <p>Communication style: <strong>{styleLabel}</strong></p>}{disclosedFacts.length ? <ul>{disclosedFacts.map(fact => <li key={fact.id}><strong>{fact.topic}</strong><p>{fact.content}</p><small>Source: Provided case profile</small></li>)}</ul> : <p>Facts shared by the patient will appear here.</p>}</section><div className="aside-note">{mode === 'preview' ? 'Preview uses authored replies and your device voice. Live AI connects to the encounter backend.' : 'Patient replies and voice come from the encounter backend. Captions are reviewed before sending.'}</div></aside>
      </div><footer className="page-footer"><span><span className="tiny-brand">✳</span> Practice empathy. Build confidence.</span><span>CaseCoach · Rutgers HealthHack</span></footer>
      </div>
    </main>
    </div>
    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close information" onClick={() => setHelpOpen(false)}><X size={19}/></button><div className="eyebrow">HOW IT WORKS</div><h2 id="help-title">A little room to practice.</h2><ol><li>Choose Wyatt or Yvette and begin.</li><li>Speak or type a question. Review your captions before sending.</li><li>Listen to the reply and follow the patient's story.</li></ol><p>Preview uses fixed, authored sample replies and optional device speech. It is not AI. Live AI requires the encounter team's backend with these two cases installed.</p><p>Patient facts follow the supplied sample CSV. Illustrations, dialogue, and conversational behavior are simulation choices; the illustrations do not reproduce the source portraits. No clinical grades are generated here.</p><button className="primary-button" onClick={() => setHelpOpen(false)}>Got it <Check size={16}/></button></section></div>}
    {endOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="end-title"><h2 id="end-title">Finish this conversation?</h2><p>{mode === 'preview' ? 'You can review the conversation here until you start again or reload. This preview is not saved to AWS.' : 'The backend will end your encounter. Transcript storage is handled by its session integration.'}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setEndOpen(false)} disabled={busy || ending}>Keep practicing</button><button className="primary-button" onClick={finish} disabled={phase !== 'ready' && phase !== 'speaking'}>{ending ? 'Retry ending session' : 'End session'}</button></div>{ending && error && <p className="error-message">{error}</p>}</section></div>}
    {confirmPatient && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="switch-title"><h2 id="switch-title">Meet {confirmPatient.name.split(' ')[0]} instead?</h2><p>{mode === 'preview' ? 'Switching clears this preview conversation.' : 'Finish your current encounter before switching patients.'}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirmPatient(null)}>Stay here</button><button className="primary-button" onClick={switchConfirmed}>{mode === 'preview' ? 'Switch patient' : 'Finish current encounter'}</button></div></section></div>}
  </div>;
}
