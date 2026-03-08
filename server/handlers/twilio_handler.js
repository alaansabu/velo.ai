/**
 * Twilio Handler (HTTP routes)
 *
 * Endpoints:
 *   POST /twilio/call       - Initiate an outbound call
 *   POST /twilio/twiml      - Returns TwiML (Twilio fetches this when call connects)
 *   POST /twilio/status     - Call status webhook (logging only)
 *   POST /twilio/stream-status - Media stream status webhook (logging only)
 */
const { Router } = require("express");
const twilioService = require("../services/twilio_service");

const router = Router();

// ── Initiate an outbound call ───────────────────────────────────────────────
router.post("/call", async (req, res, next) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ error: "Missing 'to' phone number (E.164 format)" });
    }

    const result = await twilioService.makeCall({ to, ctx: req.ctx });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── TwiML endpoint — Twilio fetches this when the call connects ─────────────
router.post("/twiml", (req, res) => {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    console.error("[TwilioHandler] SERVER_URL not set");
    return res.status(500).send("SERVER_URL not configured");
  }

  const twiml = twilioService.generateStreamTwiml(serverUrl);
  console.log("[TwilioHandler] Serving TwiML for media stream");
  res.type("text/xml").send(twiml);
});

// ── Call status webhook (for logging) ───────────────────────────────────────
router.post("/status", (req, res) => {
  const { CallSid, CallStatus, To, From } = req.body;
  console.log(`[TwilioHandler] Call ${CallSid}: ${CallStatus} (${From} → ${To})`);
  res.sendStatus(200);
});

// ── Media stream status webhook (for logging) ──────────────────────────────
router.post("/stream-status", (req, res) => {
  console.log("[TwilioHandler] Stream status:", req.body);
  res.sendStatus(200);
});

module.exports = router;
