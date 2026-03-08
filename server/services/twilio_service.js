/**
 * TwilioService
 *
 * Handles outbound call initiation via Twilio REST API.
 * When a call connects, Twilio opens a Media Stream WebSocket back
 * to our server — that stream is handled by twilio_ws_handler.js.
 *
 * No Express / HTTP knowledge lives here.
 */
const twilio = require("twilio");

// ────────────────────────────────────────────────────────────────────────────
// Twilio client (singleton)
// ────────────────────────────────────────────────────────────────────────────
let _client = null;

function getTwilioClient() {
  if (!_client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
    }
    _client = twilio(sid, token);
  }
  return _client;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Make an outbound call.
 * Twilio will fetch TwiML from `SERVER_URL/twilio/twiml` which tells it
 * to open a Media Stream WebSocket back to `SERVER_URL/twilio-stream`.
 *
 * @param {Object}  opts
 * @param {string}  opts.to   - Phone number to call (E.164 format, e.g. +911234567890)
 * @param {Object}  [opts.ctx] - RequestContext for tracing
 * @returns {Promise<Object>}  Twilio call resource
 */
async function makeCall({ to, ctx = null } = {}) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  const serverUrl = process.env.SERVER_URL;

  if (!from) throw new Error("TWILIO_PHONE_NUMBER environment variable is not set");
  if (!serverUrl) throw new Error("SERVER_URL environment variable is not set");

  const client = getTwilioClient();

  _log(ctx, `Initiating call: ${from} → ${to}`);

  const call = await client.calls.create({
    to,
    from,
    url: `${serverUrl}/twilio/twiml`, // Twilio fetches TwiML from here
    statusCallback: `${serverUrl}/twilio/status`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  _log(ctx, `Call created: SID=${call.sid}, status=${call.status}`);
  return { callSid: call.sid, status: call.status };
}

/**
 * Generate TwiML that tells Twilio to open a bidirectional Media Stream.
 * @param {string} serverUrl - The public URL of this server (wss://)
 * @returns {string} TwiML XML
 */
function generateStreamTwiml(serverUrl) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  // Open a bidirectional media stream back to our server
  const connect = response.connect();
  const wsUrl = serverUrl.replace(/^http/, "ws") + "/twilio-stream";
  console.log(`[TwilioService] Stream WS URL: ${wsUrl}`);
  connect.stream({
    url: wsUrl,
  });

  return response.toString();
}

// ────────────────────────────────────────────────────────────────────────────
// Internal
// ────────────────────────────────────────────────────────────────────────────
function _log(ctx, message) {
  const prefix = ctx ? `[TwilioService] [${ctx.requestId}]` : "[TwilioService]";
  console.log(`${prefix} ${message}`);
}

module.exports = {
  makeCall,
  generateStreamTwiml,
};
