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

  useEffect(() => {
    if (followCaptions) setDraft(captionText(enc.captions));
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

  useEffect(() => {
    lastSent.current = "";
  }, [view.transcript.length]);

  const canTalk = view.connection === "open" && view.status === "active" && !view.waiting && !speaking;

  async function startListening() {
    setMicError(null);
    try {
      await mic.start(enc.sendAudio);
    } catch {
      setMicError("Microphone unavailable (it needs localhost or HTTPS and permission). You can type your question instead.");
      return;
    }
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

  async function send() {
    let text = draftRef.current;
    if (listening) {
      stopListening();
      if (followCaptions) {
        await enc.waitForCaptionsDone(1000);
        text = enc.getCaptionText();
      }
    }
    setFollowCaptions(false);
    text = text.trim();
    if (!text) return;
    if (enc.sendTurn(text)) {
      lastSent.current = text;
      setDraft("");
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
