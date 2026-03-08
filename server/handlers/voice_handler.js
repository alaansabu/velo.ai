/**
 * Voice Handler (Router)
 *
 * Thin HTTP layer — only responsible for:
 *   1. Extracting data from the request
 *   2. Delegating to the VoiceService
 *   3. Sending the response
 *
 * All business logic lives in services/voice_service.js.
 * Session validation is handled by the validateSession middleware.
 */
const express = require("express");
const voiceService = require("../services/voice_service");
const validateSession = require("../middlewares/validate_session");

const router = express.Router();

/**
 * POST /voice/start
 * Body (all optional): { prompt, greeting, audioUrl, language }
 *
 * Starts a new Deepgram Voice Agent session.
 */
router.post("/start", async (req, res, next) => {
  try {
    const { prompt, greeting, audioUrl, language } = req.body || {};

    const sessionId = await voiceService.startSession({
      prompt,
      greeting,
      audioUrl,
      language,
      ctx: req.ctx,
    });

    req.ctx.setSessionId(sessionId);

    res.json({
      success: true,
      sessionId,
      requestId: req.ctx.requestId,
      message: "Voice agent session started",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /voice/inject
 * Body: { sessionId, text }
 *
 * Injects a user text message into a running agent session.
 * validateSession middleware ensures the session exists.
 */
router.post("/inject", validateSession, (req, res, next) => {
  try {
    const { text } = req.body || {};

    if (!text) {
      return res.status(400).json({ success: false, error: "text is required" });
    }

    voiceService.injectMessage(req.ctx.sessionId, text);

    res.json({ success: true, message: "Message injected" });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /voice/stop
 * Body: { sessionId }
 *
 * Closes a running voice agent session.
 * validateSession middleware ensures the session exists.
 */
router.post("/stop", validateSession, (req, res, next) => {
  try {
    voiceService.stopSession(req.ctx.sessionId);

    res.json({ success: true, message: "Session stopped" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /voice/sessions
 *
 * Lists all active session IDs.
 */
router.get("/sessions", (_req, res) => {
  res.json({
    success: true,
    sessions: voiceService.listSessions(),
  });
});

module.exports = router;
