const { configDotenv } = require("dotenv");
configDotenv();

const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const path = require("path");

// ── Middlewares ──────────────────────────────────────────────────────────────
const attachContext = require("./middlewares/attach_context");
const errorHandler = require("./middlewares/error_handler");

// ── Handlers (routers) ──────────────────────────────────────────────────────
const voiceHandler = require("./handlers/voice_handler");
const twilioHandler = require("./handlers/twilio_handler");
const { attachWsHandler } = require("./handlers/ws_handler");
const { attachTwilioWsHandler } = require("./handlers/twilio_ws_handler");

const port = process.env.PORT || 3000;
const app = express();

// ── Global middleware pipeline ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded data
app.use(attachContext); // creates req.ctx (RequestContext) for every request

// ── Serve the test chat UI ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/voice", voiceHandler);
app.use("/twilio", twilioHandler);

// ── Global error handler (must be last) ─────────────────────────────────────
app.use(errorHandler);

// ── HTTP + WebSocket server ─────────────────────────────────────────────────
const server = http.createServer(app);

// Both WS servers use noServer so we manually route upgrades by path.
// This avoids conflicts and ensures Twilio WS upgrades work through ngrok.
const wss = new WebSocketServer({ noServer: true });
attachWsHandler(wss);

const twilioWss = new WebSocketServer({ noServer: true });
attachTwilioWsHandler(twilioWss);

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  console.log(`[WS Upgrade] path=${pathname}`);

  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else if (pathname === "/twilio-stream") {
    twilioWss.handleUpgrade(req, socket, head, (ws) => twilioWss.emit("connection", ws, req));
  } else {
    console.log(`[WS Upgrade] Unknown path: ${pathname}, destroying socket`);
    socket.destroy();
  }
});

server.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Test chat UI → http://localhost:${port}`);

  // ── Auto-start ngrok tunnel for Twilio webhooks ─────────────────────
  if (!process.env.SERVER_URL || process.env.SERVER_URL.includes("your-ngrok")) {
    try {
      const ngrok = require("@ngrok/ngrok");
      const listener = await ngrok.forward({
        addr: port,
        authtoken: process.env.NGROK_AUTH_TOKEN,
      });
      const url = listener.url();
      process.env.SERVER_URL = url;
      console.log(`\n🌐 ngrok tunnel active → ${url}`);
      console.log(`   Twilio TwiML URL  → ${url}/twilio/twiml`);
      console.log(`   Make a call       → curl -X POST http://localhost:${port}/twilio/call -H "Content-Type: application/json" -d '{"to":"+91XXXXXXXXXX"}'\n`);
    } catch (err) {
      console.warn("⚠ ngrok failed to start:", err.message);
      console.warn("  Set SERVER_URL manually in .env or run: ngrok http 3000");
    }
  }
});