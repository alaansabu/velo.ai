/**
 * Twilio WebSocket Handler
 *
 * Bridges Twilio Media Streams ↔ Deepgram Voice Agent.
 *
 * Twilio Media Streams protocol:
 *   - All messages are JSON (not binary)
 *   - Audio is base64-encoded mulaw 8kHz mono
 *   - Events: connected, start, media, stop, mark
 *
 * Flow:
 *   1. Twilio opens WS → sends "connected" then "start" events
 *   2. We start a Deepgram agent session with mulaw 8kHz config
 *   3. Twilio sends "media" events (base64 audio) → we decode → send to Deepgram
 *   4. Deepgram sends audio back → we base64 encode → send to Twilio as "media" events
 */
const voiceService = require("../services/voice_service");
const { serviceEvents } = voiceService;

/**
 * Attach Twilio Media Stream WebSocket handling to a ws.Server.
 * @param {import('ws').Server} wss
 */
function attachTwilioWsHandler(wss) {
  wss.on("connection", (ws) => {
    console.log("[TwilioWs] Twilio media stream connected");

    let sessionId = null;
    let streamSid = null;

    // ── Forward Deepgram JSON events (logging only for Twilio calls) ──
    const onEvent = (evtSessionId, data) => {
      if (evtSessionId !== sessionId) return;
      switch (data.type) {
        case "ConversationText":
          console.log(`[TwilioWs] 💬 [${data.role}]: ${data.content}`);
          break;
        case "AgentStartedSpeaking":
          console.log("[TwilioWs] 🗣️  Agent speaking");
          break;
        case "AgentAudioDone":
          // Send a mark to Twilio so we know when playback finishes
          if (ws.readyState === ws.OPEN && streamSid) {
            ws.send(JSON.stringify({
              event: "mark",
              streamSid,
              mark: { name: "agent_audio_done" },
            }));
          }
          break;
        case "UserStartedSpeaking":
          // Clear Twilio's audio queue on barge-in
          if (ws.readyState === ws.OPEN && streamSid) {
            ws.send(JSON.stringify({ event: "clear", streamSid }));
          }
          break;
        case "Error":
          console.error(`[TwilioWs] ❌ ${data.description}`);
          break;
        default:
          break;
      }
    };
    serviceEvents.on("event", onEvent);

    // ── Forward Deepgram audio → Twilio (base64 mulaw) ────────────────
    const onAudio = (evtSessionId, audioBuffer) => {
      if (evtSessionId !== sessionId) return;
      if (ws.readyState !== ws.OPEN || !streamSid) return;

      // Deepgram returns mulaw 8kHz when configured that way — already
      // in the right format, just base64-encode it for Twilio
      const payload = audioBuffer.toString("base64");

      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        media: { payload },
      }));
    };
    serviceEvents.on("audio", onAudio);

    // ── Handle incoming Twilio messages ───────────────────────────────
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      switch (msg.event) {
        // Twilio connected — metadata only
        case "connected":
          console.log("[TwilioWs] Twilio connected event received");
          break;

        // Stream started — now we know the streamSid and can start Deepgram
        case "start":
          streamSid = msg.start.streamSid;
          console.log(`[TwilioWs] Stream started: ${streamSid}`);

          try {
            sessionId = await voiceService.startSession({
              audioConfig: {
                inputEncoding: "mulaw",
                inputSampleRate: 8000,
                outputEncoding: "mulaw",
                outputSampleRate: 8000,
              },
            });
            console.log(`[TwilioWs] Deepgram session started: ${sessionId}`);
          } catch (err) {
            console.error("[TwilioWs] Failed to start Deepgram session:", err.message);
            ws.close();
          }
          break;

        // Audio from the caller → forward to Deepgram
        case "media":
          if (sessionId && msg.media && msg.media.payload) {
            const audioBuffer = Buffer.from(msg.media.payload, "base64");
            const session = require("../repositories/session_repository").findById(sessionId);
            if (session) {
              session.sendAudio(audioBuffer);
            }
          }
          break;

        // Twilio stream ended
        case "stop":
          console.log("[TwilioWs] Twilio stream stopped");
          _cleanup();
          break;

        default:
          break;
      }
    });

    // ── Cleanup ──────────────────────────────────────────────────────
    function _cleanup() {
      serviceEvents.off("event", onEvent);
      serviceEvents.off("audio", onAudio);
      if (sessionId) {
        try {
          voiceService.stopSession(sessionId);
        } catch { /* already closed */ }
        sessionId = null;
      }
      streamSid = null;
    }

    ws.on("close", () => {
      console.log("[TwilioWs] Twilio WS disconnected");
      _cleanup();
    });

    ws.on("error", (err) => {
      console.error("[TwilioWs] WS error:", err.message);
      _cleanup();
    });
  });
}

module.exports = { attachTwilioWsHandler };
