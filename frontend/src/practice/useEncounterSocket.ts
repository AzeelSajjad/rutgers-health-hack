import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@casecoach/shared";
import { captionReducer, captionText, emptyCaptions, type CaptionAction, type CaptionState } from "./captions";
import { encounterReducer, initialEncounterView } from "./encounterReducer";

const storageKey = (caseId: string) => `casecoach:session:${caseId}`;
const storage = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode: resume just won't work */
    }
  },
  remove: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export function useEncounterSocket(caseId: string) {
  const [view, dispatch] = useReducer(encounterReducer, initialEncounterView);
  const [captions, dispatchCaption] = useReducer(captionReducer, emptyCaptions);
  const socket = useRef<WebSocket | null>(null);
  // Mirrors caption state synchronously so code awaiting caption_done reads the final text, not a stale render.
  const latestCaptions = useRef<CaptionState>(emptyCaptions);
  const captionWaiters = useRef<(() => void)[]>([]);

  const applyCaption = useCallback((a: CaptionAction) => {
    latestCaptions.current = captionReducer(latestCaptions.current, a);
    dispatchCaption(a);
  }, []);

  useEffect(() => {
    const key = storageKey(caseId);
    let disposed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      dispatch({ type: "connecting" });
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      const sendJson = (m: ClientMessage) => ws.send(JSON.stringify(m));
      // True while this connection's resume_session is unanswered.
      let resuming = false;

      ws.onopen = () => {
        dispatch({ type: "connected" });
        const saved = storage.get(key);
        resuming = !!saved;
        sendJson(saved ? { type: "resume_session", sessionId: saved } : { type: "start_session", caseId });
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data) as ServerMessage;
        } catch {
          return; // ignore malformed frames
        }
        switch (msg.type) {
          case "caption":
            applyCaption({ type: "caption", text: msg.text, isFinal: msg.isFinal });
            return;
          case "caption_done":
            captionWaiters.current.splice(0).forEach((resolve) => resolve());
            return;
          case "session_started":
            // Reset the backoff only once a session is live, so failed resumes keep backing off.
            attempt = 0;
            resuming = false;
            storage.set(key, msg.sessionId);
            break;
          case "session_ended":
            storage.remove(key);
            break;
          case "error":
            if (msg.code === "RESUME_FAILED") {
              resuming = false;
              storage.remove(key);
              sendJson({ type: "start_session", caseId });
            } else if (resuming) {
              // Transient resume failure: keep the stored id and let the backoff reconnect resume again.
              resuming = false;
              ws.close();
            }
            break;
        }
        dispatch(msg);
      };
      ws.onclose = () => {
        if (socket.current === ws) socket.current = null;
        dispatch({ type: "disconnected" });
        if (disposed) return;
        retry = setTimeout(connect, Math.min(10_000, 1000 * 2 ** attempt++));
      };
    };

    connect();
    return () => {
      // Detach handlers first so a StrictMode double-mount can't dispatch a stale "disconnected".
      disposed = true;
      clearTimeout(retry);
      const ws = socket.current;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = null;
        ws.close();
      }
      socket.current = null;
    };
  }, [caseId, applyCaption]);

  const sendJson = useCallback((m: ClientMessage): boolean => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(m));
    return true;
  }, []);

  return {
    view,
    captions,
    sendTurn: useCallback(
      (text: string): boolean => {
        if (!sendJson({ type: "student_turn", text })) return false;
        dispatch({ type: "turn_sent" });
        return true;
      },
      [sendJson],
    ),
    startCaptions: useCallback(() => {
      applyCaption({ type: "reset" });
      sendJson({ type: "caption_start" });
    }, [sendJson, applyCaption]),
    stopCaptions: useCallback(() => {
      sendJson({ type: "caption_stop" });
    }, [sendJson]),
    sendAudio: useCallback((pcm: ArrayBuffer) => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(pcm);
    }, []),
    waitForCaptionsDone: useCallback(
      (timeoutMs: number) =>
        new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            captionWaiters.current = captionWaiters.current.filter((w) => w !== done);
            resolve();
          };
          const timer = setTimeout(done, timeoutMs);
          captionWaiters.current.push(done);
        }),
      [],
    ),
    getCaptionText: useCallback(() => captionText(latestCaptions.current), []),
    endSession: useCallback(() => {
      sendJson({ type: "end_session" });
    }, [sendJson]),
    markAudioPlayed: useCallback(() => dispatch({ type: "audio_played" }), []),
  };
}
