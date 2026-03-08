const { DeepgramClient } = require("@deepgram/sdk");
const { writeFile } = require("fs/promises");
const { createReadStream } = require("fs");
const { join } = require("path");
const fetch = require("cross-fetch");

/**
 * Creates and manages a Deepgram Voice Agent WebSocket session.
 *
 * @param {Object} options
 * @param {string} [options.prompt]        - System prompt for the LLM (think provider).
 * @param {string} [options.greeting]      - Greeting the agent speaks when the session starts.
 * @param {string} [options.audioFilePath] - Optional path to a .wav file to stream as user audio.
 * @param {string} [options.audioUrl]      - Optional URL of a .wav file to stream as user audio.
 * @param {string} [options.language]      - BCP-47 language code (default "en").
 * @returns {Promise<{ connection: object, close: Function }>}
 */
async function createVoiceAgent(options = {}) {
  const {
    prompt = "You are a friendly AI voice assistant. Keep your answers concise.",
    greeting = "Hello! How can I help you today?",
    audioFilePath = null,
    audioUrl = null,
    language = "en",
  } = options;

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY environment variable is not set");
  }

  // ── 1. Initialise the Deepgram client ──────────────────────────────────
  const deepgramClient = new DeepgramClient({ apiKey });

  // ── 2. Create the agent WebSocket (not yet connected) ──────────────────
  const connection = await deepgramClient.agent.v1.createConnection();

  let keepAliveInterval = null;
  let fileCounter = 0;

  // ── 3. Event handlers ─────────────────────────────────────────────────
  connection.on("open", () => {
    console.log("[VoiceAgent] ✓ WebSocket connection opened");
  });

  connection.on("message", (data) => {
    // Binary audio from the agent comes as string / buffer in the SDK
    if (typeof data === "string" || data instanceof ArrayBuffer || data instanceof Buffer) {
      console.log("[VoiceAgent] 🔊 Audio chunk received");
      return;
    }

    switch (data.type) {
      case "Welcome":
        console.log("[VoiceAgent] Welcome:", data);
        break;

      case "SettingsApplied":
        console.log("[VoiceAgent] ✓ Settings applied");
        break;

      case "ConversationText":
        console.log(`[VoiceAgent] 💬 [${data.role}]: ${data.content}`);
        break;

      case "UserStartedSpeaking":
        console.log("[VoiceAgent] 🎙️  User started speaking");
        break;

      case "AgentThinking":
        console.log("[VoiceAgent] 🤔 Agent thinking…", data.content || "");
        break;

      case "AgentStartedSpeaking":
        console.log("[VoiceAgent] 🗣️  Agent started speaking");
        break;

      case "AgentAudioDone":
        console.log("[VoiceAgent] ✓ Agent audio done");
        fileCounter++;
        break;

      case "Error":
        console.error("[VoiceAgent] ❌ Error:", data.description);
        break;

      case "Warning":
        console.warn("[VoiceAgent] ⚠️  Warning:", data.description);
        break;

      default:
        console.log("[VoiceAgent] Event:", data.type, data);
    }
  });

  connection.on("error", (error) => {
    console.error("[VoiceAgent] WebSocket error:", error.message || error);
  });

  connection.on("close", (event) => {
    console.log("[VoiceAgent] WebSocket closed");
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  });

  // ── 4. Connect ─────────────────────────────────────────────────────────
  connection.connect();
  await connection.waitForOpen();

  // ── 5. Send settings to configure the agent ────────────────────────────
  connection.sendSettings({
    type: "Settings",
    audio: {
      input: {
        encoding: "linear16",
        sample_rate: 24000,
      },
      output: {
        encoding: "linear16",
        sample_rate: 16000,
        container: "wav",
      },
    },
    agent: {
      language,
      listen: {
        provider: {
          type: "deepgram",
          model: "nova-3",
        },
      },
      think: {
        provider: {
          type: "open_ai",
          model: "gpt-4o-mini",
        },
        prompt,
      },
      speak: {
        provider: {
          type: "deepgram",
          model: "aura-2-thalia-en",
        },
      },
      greeting,
    },
  });

  console.log("[VoiceAgent] Settings sent");

  // ── 6. Keep-alive every 5 s ────────────────────────────────────────────
  keepAliveInterval = setInterval(() => {
    if (connection.socket && connection.socket.readyState === 1) {
      connection.sendKeepAlive({ type: "KeepAlive" });
    } else {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  }, 5000);

  // ── 7. Stream audio if a file/URL was provided ─────────────────────────
  if (audioFilePath) {
    const audioStream = createReadStream(audioFilePath);
    audioStream.on("data", (chunk) => {
      connection.sendMedia(chunk);
    });
    audioStream.on("end", () => {
      console.log("[VoiceAgent] Finished streaming audio file");
    });
  } else if (audioUrl) {
    const response = await fetch(audioUrl);
    const reader = response.body;
    // Skip the 44-byte WAV header
    const headerBuf = Buffer.alloc(44);
    let headerBytesRead = 0;
    reader.on("data", (chunk) => {
      if (headerBytesRead < 44) {
        const needed = 44 - headerBytesRead;
        if (chunk.length <= needed) {
          chunk.copy(headerBuf, headerBytesRead);
          headerBytesRead += chunk.length;
          return;
        }
        chunk.copy(headerBuf, headerBytesRead, 0, needed);
        headerBytesRead = 44;
        chunk = chunk.slice(needed);
      }
      connection.sendMedia(chunk);
    });
    reader.on("end", () => {
      console.log("[VoiceAgent] Finished streaming audio URL");
    });
  }

  // ── 8. Return a handle so callers can interact / tear down ─────────────
  return {
    connection,
    close: () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      connection.close();
      console.log("[VoiceAgent] Session closed");
    },
    /** Send raw audio bytes (Buffer) into the agent */
    sendAudio: (buffer) => {
      connection.sendMedia(buffer);
    },
    /** Inject a text message as if the user said it */
    injectUserMessage: (text) => {
      connection.sendInjectUserMessage({
        type: "InjectUserMessage",
        content: text,
      });
    },
    /** Make the agent speak a specific message (no LLM) */
    injectAgentMessage: (text) => {
      connection.sendInjectAgentMessage({
        type: "InjectAgentMessage",
        message: text,
      });
    },
    /** Update the system prompt on the fly */
    updatePrompt: (newPrompt) => {
      connection.sendUpdatePrompt({
        type: "UpdatePrompt",
        prompt: newPrompt,
      });
    },
  };
}

module.exports = { createVoiceAgent };
