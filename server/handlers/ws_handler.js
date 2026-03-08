/**
 * WebSocket Handler
 *
 * Bridges browser WebSocket ↔ VoiceService for real-time voice chat.
 * Each browser WS connection gets its own Deepgram agent session.
 *
 * Browser sends:
 *   binary (ArrayBuffer)                → raw mic PCM audio forwarded to Deepgram
 *   { action: "stop" }                  → closes the session
 *
 * Browser receives:
 *   binary (Buffer)                     → agent audio to play in speaker
 *   JSON events (ConversationText, AgentThinking, etc.)
 */
const voiceService = require("../services/voice_service");
const { serviceEvents } = voiceService;
const sessionRepository = require("../repositories/session_repository");

/**
 * Attach WebSocket handling to an existing ws.Server instance.
 * @param {import('ws').Server} wss
 */
function attachWsHandler(wss) {
  wss.on("connection", async (ws) => {
    console.log("[WsHandler] Browser connected");

    let sessionId = null;

    // ── Forward Deepgram JSON events to this browser socket ─────────
    const onEvent = (evtSessionId, data) => {
      if (evtSessionId !== sessionId) return;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
      }
    };
    serviceEvents.on("event", onEvent);

    // ── Forward Deepgram audio to browser as binary ─────────────────
    const onAudio = (evtSessionId, audioBuffer) => {
      if (evtSessionId !== sessionId) return;
      if (ws.readyState === ws.OPEN) {
        ws.send(audioBuffer);
      }
    };
    serviceEvents.on("audio", onAudio);

    // ── Start a voice agent session for this connection ─────────────
    try {
      sessionId = await voiceService.startSession({});

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "SessionStarted", sessionId }));
      }
    } catch (err) {
      console.error("[WsHandler] Failed to start session:", err.message);
      ws.send(JSON.stringify({ type: "Error", description: err.message }));
      ws.close();
      return;
    }

    // ── Handle incoming messages from the browser ───────────────────
    ws.on("message", (raw, isBinary) => {
      // Binary → mic audio from browser, forward to Deepgram
      if (isBinary) {
        const session = sessionRepository.findById(sessionId);
        if (session) {
          session.sendAudio(Buffer.from(raw));
        }
        return;
      }

      // Text → JSON control message
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      switch (msg.action) {
        case "stop":
          _cleanup();
          break;
        default:
          break;
      }
    });

    // ── Cleanup on disconnect ───────────────────────────────────────
    function _cleanup() {
      serviceEvents.off("event", onEvent);
      serviceEvents.off("audio", onAudio);
      if (sessionId) {
        try {
          voiceService.stopSession(sessionId);
        } catch { /* already closed */ }
        sessionId = null;
      }
    }

    ws.on("close", () => {
      console.log("[WsHandler] Browser disconnected");
      _cleanup();
    });

    ws.on("error", (err) => {
      console.error("[WsHandler] WS error:", err.message);
      _cleanup();
    });
  });
}

module.exports = { attachWsHandler };
