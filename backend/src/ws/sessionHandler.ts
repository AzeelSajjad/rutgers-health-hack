import { ClientMessageSchema, type EncounterState, type PatientCase, type ServerMessage } from "@casecoach/shared";
import { disclosedFactsFor, disclosedChartFor } from "../engine/disclosure.js";
import {
  EncounterError,
  endEncounter,
  getActiveEncounter,
  runTurn,
  startEncounter,
  type EncounterErrorCode,
  type EngineDeps,
} from "../engine/encounter.js";
import { styleLabel } from "../engine/style.js";
import type { CaptionStream, Stt } from "../speech/transcribe.js";
import { withSessionLock } from "./sessionLock.js";

export interface HandlerDeps extends EngineDeps {
  stt: Stt;
  review?: import("../review/facultyRoutes.js").FacultyReviewStore;
}

const FRIENDLY: Record<EncounterErrorCode, string> = {
  EMPTY_TURN: "I didn't catch a question. Please try again.",
  TURN_TOO_LONG: "That question is too long. Please shorten it.",
  TURN_LIMIT: "This session has reached its turn limit. Please end it and start a new one.",
  SESSION_NOT_FOUND: "This session no longer exists. Please start a new one.",
  SESSION_ENDED: "This session has ended. Please start a new one.",
  CASE_NOT_FOUND: "That patient case could not be found.",
  SESSION_FULL: "This session is full. Please end it and start a new one.",
};

/** Hard cap on one caption stream so a client can't hold a Transcribe stream open indefinitely. */
export const MAX_CAPTION_MS = 120_000;

const RESUME_GONE = new Set<EncounterErrorCode>(["SESSION_NOT_FOUND", "SESSION_ENDED", "CASE_NOT_FOUND"]);

function sessionStarted(state: EncounterState, c: PatientCase, resumed: boolean): ServerMessage {
  return {
    type: "session_started",
    sessionId: state.sessionId,
    resumed,
    patient: { name: c.patientName, age: c.age, visitReason: c.visitReason },
    styleId: state.styleId,
    styleLabel: styleLabel(c, state.styleId),
    disclosedFacts: disclosedFactsFor(c, state.disclosedFactIds),
    chart: disclosedChartFor(c, state.disclosedFactIds),
    transcript: state.turns,
  };
}

export function createSessionHandler(deps: HandlerDeps, send: (m: ServerMessage) => void) {
  let sessionId: string | null = null;
  let busy = false;
  let caption: CaptionStream | null = null;
  // Bumped on every caption_start so callbacks from a replaced stream become no-ops.
  let captionGen = 0;
  let captionTimer: ReturnType<typeof setTimeout> | undefined;

  const fail = (message: string, scope?: "turn") =>
    send(scope ? { type: "error", message, scope } : { type: "error", message });
  const failFrom = (err: unknown, scope?: "turn") => {
    if (err instanceof EncounterError) return fail(FRIENDLY[err.code], scope);
    deps.log?.("session handler error", err);
    fail("Something went wrong. Please try again.", scope);
  };

  /** graceful: end() so buffered audio is transcribed and the final caption arrives; otherwise cancel(). */
  const stopCaptions = (mode: "graceful" | "cancel") => {
    clearTimeout(captionTimer);
    captionTimer = undefined;
    if (mode === "graceful") caption?.end();
    else caption?.cancel();
    caption = null;
  };

  async function onMessage(raw: string): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return fail("Invalid message");
    }
    const parsed = ClientMessageSchema.safeParse(data);
    if (!parsed.success) return fail("Invalid message");
    const msg = parsed.data;

    switch (msg.type) {
      case "start_session": {
        if (sessionId) return fail("Session already started");
        if (busy) return fail("Please wait");
        busy = true;
        try {
          const { state, patientCase } = await startEncounter(deps, msg.caseId);
          sessionId = state.sessionId;
          send(sessionStarted(state, patientCase, false));
        } catch (err) {
          failFrom(err);
        } finally {
          busy = false;
        }
        return;
      }

      case "resume_session": {
        if (sessionId) return fail("Session already started");
        if (busy) return fail("Please wait");
        busy = true;
        try {
          const { state, patientCase } = await withSessionLock(msg.sessionId, () =>
            getActiveEncounter(deps, msg.sessionId),
          );
          sessionId = state.sessionId;
          send(sessionStarted(state, patientCase, true));
        } catch (err) {
          // Only a session that is really gone is RESUME_FAILED (the client then starts over).
          // Anything else may be transient: the client keeps its session id and retries.
          if (err instanceof EncounterError && RESUME_GONE.has(err.code)) {
            send({ type: "error", message: "Could not resume the previous session. Starting a new one.", code: "RESUME_FAILED" });
          } else {
            deps.log?.("resume failed", err);
            fail("Could not reconnect to your session. Retrying…");
          }
        } finally {
          busy = false;
        }
        return;
      }

      case "student_turn": {
        if (!sessionId) return fail("No active session", "turn");
        if (busy) return fail("The patient is still responding", "turn");
        busy = true;
        send({ type: "patient_thinking" });
        try {
          const id = sessionId;
          const r = await withSessionLock(id, () => runTurn(deps, id, msg.text));
          send({
            type: "patient_turn",
            studentTurn: r.studentTurn,
            patientTurn: r.patientTurn,
            audioBase64: r.audio ? r.audio.toString("base64") : null,
            styleId: r.state.styleId,
            styleLabel: styleLabel(r.patientCase, r.state.styleId),
            disclosedFacts: disclosedFactsFor(r.patientCase, r.state.disclosedFactIds),
            chart: disclosedChartFor(r.patientCase, r.state.disclosedFactIds),
          });
        } catch (err) {
          failFrom(err, "turn");
        } finally {
          busy = false;
        }
        return;
      }

      case "caption_start": {
        if (!sessionId) return fail("No active session");
        stopCaptions("cancel");
        const gen = ++captionGen;
        let finished = false;
        const live = () => gen === captionGen && !finished;
        const finish = () => {
          if (!live()) return;
          finished = true;
          send({ type: "caption_done" });
        };
        try {
          const stream: CaptionStream = deps.stt.start(
            (text, isFinal) => {
              if (live()) send({ type: "caption", text, isFinal });
            },
            finish,
            (err) => {
              deps.log?.("speech recognition failed", err);
              if (caption === stream) caption = null;
              if (!live()) return;
              fail("Speech recognition stopped. Please try again or type your question.");
              finish();
            },
          );
          caption = stream;
          captionTimer = setTimeout(() => stopCaptions("cancel"), MAX_CAPTION_MS);
        } catch (err) {
          failFrom(err);
        }
        return;
      }

      case "caption_stop":
        stopCaptions("graceful");
        return;

      case "end_session": {
        if (!sessionId) return fail("No active session");
        if (busy) return fail("The patient is still responding");
        busy = true;
        stopCaptions("cancel");
        try {
          const id = sessionId;
          const ended = await withSessionLock(id, () => endEncounter(deps, id));
          sessionId = null;
          send({ type: "session_ended", sessionId: ended.sessionId });
        } catch (err) {
          failFrom(err);
        } finally {
          busy = false;
        }
        return;
      }
    }
  }

  return {
    onMessage,
    onAudio: (chunk: Buffer) => caption?.push(chunk),
    onClose: () => stopCaptions("cancel"),
  };
}
