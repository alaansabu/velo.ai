/**
 * VoiceService
 *
 * Business-logic layer for the Deepgram Voice Agent.
 * This is the ONLY place that talks to the Deepgram SDK.
 * It uses SessionRepository for persistence and RequestContext for tracing.
 *
 * No Express / HTTP knowledge lives here.
 */
const { DeepgramClient } = require("@deepgram/sdk");
const { createReadStream, readFileSync, readdirSync } = require("fs");
const { join } = require("path");
const fetch = require("cross-fetch");
const { EventEmitter } = require("events");
const sessionRepository = require("../repositories/session_repository");

// ────────────────────────────────────────────────────────────────────────────
// Script loader — reads all .txt files from the script/ folder
// ────────────────────────────────────────────────────────────────────────────
const SCRIPT_DIR = join(__dirname, "..", "script");

function loadScripts() {
  try {
    const files = readdirSync(SCRIPT_DIR).filter((f) => f.endsWith(".txt"));
    if (files.length === 0) return null;

    const combined = files
      .map((f) => {
        const content = readFileSync(join(SCRIPT_DIR, f), "utf-8").trim();
        return `--- ${f} ---\n${content}`;
      })
      .join("\n\n");

    return combined;
  } catch (err) {
    console.warn("[VoiceService] Could not load scripts:", err.message);
    return null;
  }
}

function buildPromptWithScript(userPrompt) {
  const scriptContent = loadScripts();
  if (!scriptContent) return userPrompt;

  return [
    // ── Role & personality ─────────────────────────────────────────────
    `You are "Jio Care", a friendly outbound call-center voice agent for Jio.`,
    `Your goal: assist customers with mobile recharges, plan renewals, and queries.`,
    ``,
    // ── Voice style rules ──────────────────────────────────────────────
    `VOICE STYLE RULES (always follow):`,
    `- Speak naturally in short, warm sentences — never sound robotic or scripted.`,
    `- Keep every response under 2-3 sentences unless the customer asks for detail.`,
    `- Use "Sir" or "Ma'am" politely but don't overdo it.`,
    `- NEVER read [NOTE] sections aloud — those are internal-only guidance.`,
    `- NEVER recite bullet-point lists. Mention at most 2-3 plans conversationally.`,
    `- When quoting plans, say the price and key benefit naturally, e.g. "Our 299 rupee plan gives you 2GB per day with unlimited calls for 28 days."`,
    `- Pause briefly after asking a question — let the customer respond.`,
    ``,
    // ── Plan knowledge ─────────────────────────────────────────────────
    `PLAN KNOWLEDGE:`,
    `- The script below contains a "QUICK REFERENCE" pricing table. Use it as your single source of truth for plan prices, data, validity, and benefits.`,
    `- Always quote EXACT prices from the reference table — never guess or round.`,
    `- Recommend the Rs. 299 plan as the default unless the customer asks for cheaper, longer, or 5G options.`,
    `- For budget customers → suggest Rs. 155, Rs. 179, or Rs. 209 plans.`,
    `- For long-term value → suggest Rs. 533, Rs. 999, or Rs. 1,799 plans.`,
    `- For 5G users → suggest Rs. 349 (5G), Rs. 629, or Rs. 1,299 plans.`,
    `- When comparing plans, highlight the value difference (e.g. per-day cost, extra validity).`,
    ``,
    // ── Scenario handling ──────────────────────────────────────────────
    `SCENARIO HANDLING:`,
    `- The script covers 10 customer scenarios (agree, delay, cheap plan, complaint, port-out, elderly, fraud suspicion, already recharged, can't afford, language barrier).`,
    `- Match the customer's response to the closest scenario and follow that flow.`,
    `- If the customer says something not covered, stay polite and steer back to recharge assistance.`,
    `- NEVER pressure the customer. If they say no, acknowledge it gracefully.`,
    ``,
    // ── Security rules ─────────────────────────────────────────────────
    `SECURITY (non-negotiable):`,
    `- NEVER ask for OTP, PIN, CVV, password, bank details, or Aadhaar.`,
    `- If a customer suspects fraud, reassure them and offer to verify via 199.`,
    ``,
    // ── Full script reference ──────────────────────────────────────────
    `=== FULL SCRIPT REFERENCE ===`,
    scriptContent,
    `=== END OF SCRIPT ===`,
    ``,
    userPrompt ? `Additional instructions: ${userPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Service-level event bus — handlers/ws_handler can subscribe to this
const serviceEvents = new EventEmitter();

// ────────────────────────────────────────────────────────────────────────────
// Deepgram client (singleton)
// ────────────────────────────────────────────────────────────────────────────
let _dgClient = null;

function getDeepgramClient() {
  if (!_dgClient) {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY environment variable is not set");
    _dgClient = new DeepgramClient({ apiKey });
  }
  return _dgClient;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Start a new Deepgram Voice Agent session.
 *
 * @param {Object} opts
 * @param {string}  [opts.prompt]        - System prompt for the LLM.
 * @param {string}  [opts.greeting]      - Greeting the agent speaks on connect.
 * @param {string}  [opts.audioFilePath] - Local .wav file to stream as user audio.
 * @param {string}  [opts.audioUrl]      - Remote .wav URL to stream as user audio.
 * @param {string}  [opts.language]      - BCP-47 language code (default "en").
 * @param {Object}  [opts.audioConfig]   - Override audio settings { inputEncoding, inputSampleRate, outputEncoding, outputSampleRate }.
 * @param {Object}  [opts.ctx]           - RequestContext (for logging / tracing).
 * @returns {Promise<string>} sessionId
 */
async function startSession({
  prompt = "",
  greeting = "",
  audioFilePath = null,
  audioUrl = null,
  language = "en",
  audioConfig = null,
  ctx = null,
} = {}) {
  // Build final prompt with script context
  const finalPrompt = buildPromptWithScript(prompt);
  const finalGreeting =
    greeting ||
    "Namaste! May I speak with the account holder please? I'm calling from Jio Customer Care.";

  _log(ctx, `Prompt length: ${finalPrompt.length} chars (script loaded: ${finalPrompt.includes("SCRIPT START")})`);

  const dg = getDeepgramClient();
  const connection = await dg.agent.v1.createConnection();

  let keepAliveInterval = null;

  // ── Build session ID early so event listeners can tag it ────────────
  const sessionId = `session_${Date.now()}`;

  // ── Event listeners ──────────────────────────────────────────────────
  _attachEventListeners(connection, ctx, sessionId);

  // ── Connect & wait ───────────────────────────────────────────────────
  connection.connect();
  await connection.waitForOpen();

  // ── Intercept binary audio from the raw underlying WebSocket ─────────
  // The SDK's message handler runs JSON.parse on everything, which silently
  // drops binary frames. We tap into the raw WS to catch audio.
  const rawWs = connection.socket._ws || connection.socket;
  if (rawWs && typeof rawWs.on === "function") {
    rawWs.on("message", async (data, isBinary) => {
      if (isBinary || Buffer.isBuffer(data) || data instanceof Blob || data instanceof ArrayBuffer) {
        let buf;
        if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (data instanceof ArrayBuffer) {
          buf = Buffer.from(data);
        } else if (data instanceof Blob) {
          buf = Buffer.from(await data.arrayBuffer());
        } else {
          buf = Buffer.from(data);
        }
        serviceEvents.emit("audio", sessionId, buf);
      }
    });
    _log(ctx, "Raw WS audio listener attached");
  } else {
    // Fallback: listen via addEventListener on the reconnecting wrapper
    connection.socket.addEventListener("message", async (event) => {
      const d = event.data;
      if (d instanceof ArrayBuffer || Buffer.isBuffer(d) || d instanceof Blob) {
        let buf;
        if (Buffer.isBuffer(d)) {
          buf = d;
        } else if (d instanceof ArrayBuffer) {
          buf = Buffer.from(d);
        } else {
          buf = Buffer.from(await d.arrayBuffer());
        }
        serviceEvents.emit("audio", sessionId, buf);
      }
    });
    _log(ctx, "Fallback audio listener attached");
  }

  // ── Send agent settings ──────────────────────────────────────────────
  // Default: browser (linear16 24kHz in / linear16 16kHz out)
  // Twilio:  mulaw 8kHz both ways
  const inputEncoding    = audioConfig?.inputEncoding    || "linear16";
  const inputSampleRate  = audioConfig?.inputSampleRate  || 24000;
  const outputEncoding   = audioConfig?.outputEncoding   || "linear16";
  const outputSampleRate = audioConfig?.outputSampleRate || 16000;

  connection.sendSettings({
    type: "Settings",
    audio: {
      input: { encoding: inputEncoding, sample_rate: inputSampleRate },
      output: { encoding: outputEncoding, sample_rate: outputSampleRate, container: "none" },
    },
    agent: {
      language,
      listen: {
        provider: { type: "deepgram", model: "nova-3" },
      },
      think: {
        provider: { type: "open_ai", model: "gpt-4o-mini" },
        prompt: finalPrompt,
      },
      speak: {
        provider: { type: "deepgram", model: "aura-2-thalia-en" },
      },
      greeting: finalGreeting,
    },
  });
  _log(ctx, "Settings sent");

  // ── Keep-alive ───────────────────────────────────────────────────────
  keepAliveInterval = setInterval(() => {
    if (connection.socket && connection.socket.readyState === 1) {
      connection.sendKeepAlive({ type: "KeepAlive" });
    } else {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  }, 5000);

  // ── Stream audio if provided ─────────────────────────────────────────
  if (audioFilePath) {
    _streamLocalAudio(connection, audioFilePath, ctx);
  } else if (audioUrl) {
    await _streamRemoteAudio(connection, audioUrl, ctx);
  }

  // ── Build session handle ─────────────────────────────────────────────

  const sessionHandle = {
    connection,
    close: () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      connection.close();
      sessionRepository.delete(sessionId);
      _log(ctx, `Session ${sessionId} closed`);
    },
    sendAudio: (buffer) => connection.sendMedia(buffer),
    injectUserMessage: (text) =>
      connection.sendInjectUserMessage({ type: "InjectUserMessage", content: text }),
    injectAgentMessage: (text) =>
      connection.sendInjectAgentMessage({ type: "InjectAgentMessage", message: text }),
    updatePrompt: (newPrompt) =>
      connection.sendUpdatePrompt({ type: "UpdatePrompt", prompt: newPrompt }),
  };

  // Persist via repository
  sessionRepository.save(sessionId, sessionHandle);
  _log(ctx, `Session ${sessionId} started`);

  return sessionId;
}

/**
 * Inject a user text message into a running session.
 * @param {string} sessionId
 * @param {string} text
 */
function injectMessage(sessionId, text) {
  const session = sessionRepository.findById(sessionId);
  if (!session) throw _notFound(sessionId);
  session.injectUserMessage(text);
}

/**
 * Stop and clean up a session.
 * @param {string} sessionId
 */
function stopSession(sessionId) {
  const session = sessionRepository.findById(sessionId);
  if (!session) throw _notFound(sessionId);
  session.close();
}

/**
 * List all active session IDs.
 * @returns {string[]}
 */
function listSessions() {
  return sessionRepository.listAll();
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

function _attachEventListeners(connection, ctx, sessionId) {
  connection.on("open", () => _log(ctx, "✓ WebSocket connection opened"));

  connection.on("message", (data) => {
    // Binary audio is handled by the raw WS listener (see startSession).
    // The SDK's JSON parser will only pass parsed objects here.

    // Forward every structured event to the service bus
    serviceEvents.emit("event", sessionId, data);

    switch (data.type) {
      case "Welcome":
        _log(ctx, `Welcome: ${JSON.stringify(data)}`);
        break;
      case "SettingsApplied":
        _log(ctx, "✓ Settings applied");
        break;
      case "ConversationText":
        _log(ctx, `💬 [${data.role}]: ${data.content}`);
        break;
      case "UserStartedSpeaking":
        _log(ctx, "🎙️  User started speaking");
        break;
      case "AgentThinking":
        _log(ctx, `🤔 Agent thinking… ${data.content || ""}`);
        break;
      case "AgentStartedSpeaking":
        _log(ctx, "🗣️  Agent started speaking");
        break;
      case "AgentAudioDone":
        _log(ctx, "✓ Agent audio done");
        break;
      case "Error":
        console.error(`[VoiceService] ❌ Error: ${data.description}`);
        break;
      case "Warning":
        console.warn(`[VoiceService] ⚠️  Warning: ${data.description}`);
        break;
      default:
        _log(ctx, `Event: ${data.type}`);
    }
  });

  connection.on("error", (error) => {
    console.error("[VoiceService] WebSocket error:", error.message || error);
    serviceEvents.emit("event", sessionId, { type: "Error", description: error.message || "WebSocket error" });
  });

  connection.on("close", () => {
    _log(ctx, "WebSocket closed");
    serviceEvents.emit("event", sessionId, { type: "SessionClosed" });
  });
}

function _streamLocalAudio(connection, filePath, ctx) {
  const stream = createReadStream(filePath);
  stream.on("data", (chunk) => connection.sendMedia(chunk));
  stream.on("end", () => _log(ctx, "Finished streaming local audio"));
}

async function _streamRemoteAudio(connection, url, ctx) {
  const response = await fetch(url);
  const reader = response.body;
  let headerBytesRead = 0;

  reader.on("data", (chunk) => {
    // Skip 44-byte WAV header
    if (headerBytesRead < 44) {
      const needed = 44 - headerBytesRead;
      if (chunk.length <= needed) {
        headerBytesRead += chunk.length;
        return;
      }
      headerBytesRead = 44;
      chunk = chunk.slice(needed);
    }
    connection.sendMedia(chunk);
  });

  reader.on("end", () => _log(ctx, "Finished streaming remote audio"));
}

function _log(ctx, message) {
  const prefix = ctx ? `[VoiceService] [${ctx.requestId}]` : "[VoiceService]";
  console.log(`${prefix} ${message}`);
}

function _notFound(sessionId) {
  const err = new Error(`Session "${sessionId}" not found`);
  err.statusCode = 404;
  return err;
}

module.exports = {
  startSession,
  injectMessage,
  stopSession,
  listSessions,
  serviceEvents,
};
