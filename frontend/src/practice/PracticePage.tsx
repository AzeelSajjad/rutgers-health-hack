import { useCallback, useEffect, useRef, useState } from "react";
import { captionText } from "./captions";
import { useEncounterSocket } from "./useEncounterSocket";
import { useMicPcm } from "./useMicPcm";
import "./practice.css";

const caseId = new URLSearchParams(location.search).get("case") ?? "morgan-lee";

export function PracticePage() {
  const enc = useEncounterSocket(caseId);
  const mic = useMicPcm();
  const { view } = enc;
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  // While true, live captions overwrite the draft. Typing or sending stops it so late captions can't clobber edits.
  const [followCaptions, setFollowCaptions] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [blockedAudio, setBlockedAudio] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const lastSent = useRef("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const startingRef = useRef(false);

  useEffect(() => {
    // Only overwrite once a caption actually arrives, so starting the mic doesn't wipe typed text.
    const text = captionText(enc.captions);
    if (followCaptions && text) setDraft(text);
  }, [enc.captions, followCaptions]);

  const play = useCallback((b64: string) => {
    const audio = new Audio(`data:audio/mpeg;base64,${b64}`);
    setSpeaking(true);
    audio.onended = audio.onerror = () => setSpeaking(false);
    audio.play().catch((err: unknown) => {
      setSpeaking(false);
      if ((err as { name?: string })?.name === "NotAllowedError") setBlockedAudio(b64);
    });
  }, []);

  useEffect(() => {
    if (!view.pendingAudio) return;
    const b64 = view.pendingAudio;
    enc.markAudioPlayed();
    play(b64);
  }, [view.pendingAudio, enc.markAudioPlayed, play]);

  // A failed turn gives the student their question back so they can resend it.
  useEffect(() => {
    if (view.error && lastSent.current) {
      const text = lastSent.current;
      setDraft((d) => d || text);
      lastSent.current = "";
    }
  }, [view.error]);

  // After a reconnect, a turn lost with the old socket is missing from the resumed transcript: give it back.
  // Declared before the transcript-length effect below so it reads lastSent before that clears it.
  useEffect(() => {
    if (!view.resumes || !lastSent.current) return;
    const text = lastSent.current;
    const lastStudent = view.transcript.filter((t) => t.speaker === "student").at(-1);
    if (lastStudent?.text !== text) setDraft((d) => d || text);
    lastSent.current = "";
  }, [view.resumes, view.sessionId, view.transcript]);

  useEffect(() => {
    lastSent.current = "";
  }, [view.transcript.length]);

  const canTalk = view.connection === "open" && view.status === "active" && !view.waiting && !speaking && !sending;

  async function startListening() {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      setMicError(null);
      let started: boolean;
      try {
        started = await mic.start(enc.sendAudio);
      } catch {
        setMicError("Microphone unavailable (it needs localhost or HTTPS and permission). You can type your question instead.");
        return;
      }
      if (!started) return;
      beginCaptions();
    } finally {
      startingRef.current = false;
    }
  }

  function beginCaptions() {
    // Start Transcribe only once audio can flow; it closes streams that stay silent for about 15 s.
    enc.startCaptions();
    setFollowCaptions(true);
    setListening(true);
  }

  function stopListening() {
    mic.stop();
    enc.stopCaptions();
    setListening(false);
  }

  // Drop the mic if the connection or session goes away while listening.
  useEffect(() => {
    if (listening && (view.connection !== "open" || view.status === "ended")) {
      mic.stop();
      setListening(false);
    }
  }, [listening, view.connection, view.status, mic]);

  async function send() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      let text = draftRef.current;
      if (listening) {
        stopListening();
        if (followCaptions) {
          await enc.waitForCaptionsDone(1000);
          const captioned = enc.getCaptionText();
          if (captioned) text = captioned;
        }
      }
      setFollowCaptions(false);
      text = text.trim();
      if (!text) return;
      if (enc.sendTurn(text)) {
        lastSent.current = text;
        setDraft("");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function endSession() {
    if (listening) stopListening();
    enc.endSession();
  }

  return (
    <div className="practice">
      <header className="practice__header">
        <div>
          <h1>{view.patient ? `${view.patient.name}, ${view.patient.age}` : "Connecting…"}</h1>
          {view.patient && <p>{view.patient.visitReason} · Synthetic teaching case</p>}
        </div>
        {view.styleLabel && (
          <span className={`style-badge ${view.previousStyleLabel ? "style-badge--changed" : ""}`}>
            {view.previousStyleLabel ? `${view.previousStyleLabel} → ` : ""}
            {view.styleLabel}
          </span>
        )}
      </header>

      {view.connection !== "open" && view.status !== "starting" && (
        <p className="banner">Reconnecting to the server…</p>
      )}

      <main className="practice__body">
        <section className="panel">
          <h2>Patient conversation</h2>
          <ol className="transcript">
            {view.transcript.map((t) => (
              <li key={t.index} className={`bubble bubble--${t.speaker}`}>
                <span className="bubble__who">{t.speaker === "student" ? "You" : view.patient?.name ?? "Patient"}</span>
                {t.text}
              </li>
            ))}
            {view.waiting && <li className="bubble bubble--patient bubble--thinking">…</li>}
          </ol>

          <div className="composer">
            <textarea
              value={draft}
              placeholder={listening ? "Listening…" : "Speak or type a question"}
              onChange={(e) => {
                setFollowCaptions(false);
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canTalk) void send();
                }
              }}
              disabled={view.status !== "active"}
            />
            <div className="composer__actions">
              <button onClick={listening ? stopListening : () => void startListening()} disabled={!canTalk && !listening}>
                {listening ? "Stop" : "Start speaking"}
              </button>
              <button className="primary" onClick={() => void send()} disabled={!canTalk || (!draft.trim() && !listening)}>
                Send
              </button>
              {blockedAudio && (
                <button
                  onClick={() => {
                    const b64 = blockedAudio;
                    setBlockedAudio(null);
                    play(b64);
                  }}
                >
                  ▶ Play reply
                </button>
              )}
            </div>
            {(view.error || micError) && <p className="error">{view.error ?? micError}</p>}
          </div>
        </section>

        <aside className="panel">
          <h2>Disclosed information</h2>
          <ul className="facts">
            {view.disclosedFacts.map((f) => (
              <li key={f.id} className={view.newFactIds.includes(f.id) ? "fact fact--new" : "fact"}>
                <strong>{f.topic}</strong>
                <span>{f.content}</span>
                <small>Source: Approved case profile</small>
              </li>
            ))}
          </ul>
          <button onClick={endSession} disabled={view.status !== "active" || view.waiting || view.connection !== "open"}>
            End session
          </button>
        </aside>
      </main>
    </div>
  );
}
