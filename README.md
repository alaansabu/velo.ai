# 🎙️ VELO.AI — AI Voice Agent

Velo.ai is a high-performance, outbound AI voice agent designed for automated call center operations. Built with Deepgram’s Voice Agent API, Twilio, and Node.js, it handles natural, low-latency human conversations.

Whether through a web browser or a traditional phone line, Velo.ai follows custom scripts to guide users through workflows, provide information, or qualify leads in real-time.

---

## 🏗️ ARCHITECTURE
The project follows a clean Handler-Service-Repository pattern to ensure scalability and separation of concerns.

- Handlers: Thin HTTP/WS routes — no business logic.
- Services: Core logic — Deepgram SDK, Twilio API, script loading.
- Repository: In-memory session storage.
- Middlewares: Request context, session validation, error handling.
- Context: Per-request tracing (requestId, sessionId).

---

## 🚀 FEATURES
- Browser Voice Chat: Talk to the AI agent directly from your browser.
- Twilio Outbound Calls: AI agent calls real phone numbers via PSTN.
- Script-Driven: Agent follows call scripts located in script/*.txt.
- Real-Time Audio: Low-latency WebSocket streaming with AudioWorklet.
- Auto ngrok Tunnel: Public URL created automatically for Twilio webhooks.

---

## 🛠️ TECH STACK
- Deepgram: STT (Nova-3), LLM (GPT-4o-mini), TTS (Aura-2).
- Twilio: Outbound calls + Media Streams.
- Express 5: Modern HTTP server.
- WebSocket (ws): Browser/Twilio audio bridge.
- ngrok: Local tunnel for Twilio integration.

---


## ⚙️ SETUP & INSTALLATION

1. Install Dependencies:
   cd server
   npm install

2. Configure Environment:
   cp .env.example .env
   
   Edit .env with your keys:
   - DEEPGRAM_API_KEY
   - TWILIO_ACCOUNT_SID
   - TWILIO_AUTH_TOKEN
   - TWILIO_PHONE_NUMBER
   - NGROK_AUTH_TOKEN

3. Start the Server:
   npm run dev

---

## 📲 USAGE

Browser Voice Chat:
- Open http://localhost:3000 and tap the call button.

Make an Outbound Call:
- curl -X POST http://localhost:3000/twilio/call \
    -H "Content-Type: application/json" \
    -d '{"to": "+1XXXXXXXXXX"}'

---

## 🔗 API ENDPOINTS
- POST /voice/start    — Start a Deepgram voice session
- POST /voice/stop     — Stop a session
- POST /voice/inject   — Inject text into a session
- GET  /voice/sessions — List active sessions
- POST /twilio/call    — Make an outbound phone call
- POST /twilio/twiml   — TwiML endpoint for Twilio Media Streams

---

## 🔄 CALL FLOW
- Browser: Mic -> AudioWorklet (24kHz PCM) -> WebSocket -> Server -> Deepgram -> Speaker.
- Twilio: Twilio Dial -> Person Answers -> Media Stream WS -> Caller Audio (mulaw 8kHz) -> Deepgram -> Caller's Phone.
