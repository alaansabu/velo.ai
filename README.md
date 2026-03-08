VELO.AI — AI VOICE AGENT
=========================

An AI-powered outbound voice agent built with Deepgram Voice Agent API, Twilio, and Node.js. The agent follows call center scripts to handle real phone conversations — or you can test it directly from the browser.


ARCHITECTURE
------------
Handler → Service → Repository
   ↕          ↕
Middleware   Context

- Handlers:    Thin HTTP/WS routes — no business logic
- Services:    Core logic — Deepgram SDK, Twilio API, script loading
- Repository:  In-memory session storage
- Middlewares:  Request context, session validation, error handling
- Context:     Per-request tracing (requestId, sessionId)


FEATURES
--------
- Browser voice chat — talk to the AI agent from your browser
- Twilio outbound calls — AI agent calls real phone numbers
- Script-driven — agent follows call scripts from script/*.txt
- Real-time audio — WebSocket streaming with AudioWorklet
- Auto ngrok tunnel — public URL created automatically for Twilio


TECH STACK
----------
- Deepgram — STT (Nova-3), LLM (GPT-4o-mini), TTS (Aura-2)
- Twilio — Outbound calls + Media Streams
- Express 5 — HTTP server
- WebSocket (ws) — Browser ↔ Server ↔ Deepgram audio bridge
- ngrok — Local tunnel for Twilio webhooks


PROJECT STRUCTURE
-----------------
server/
├── server.js                  # Entry point
├── context/
│   └── request_context.js
├── handlers/
│   ├── voice_handler.js       # REST API: /voice/*
│   ├── ws_handler.js          # Browser WebSocket ↔ Deepgram
│   ├── twilio_handler.js      # REST API: /twilio/*
│   └── twilio_ws_handler.js   # Twilio Media Streams ↔ Deepgram
├── middlewares/
│   ├── attach_context.js
│   ├── validate_session.js
│   └── error_handler.js
├── services/
│   ├── voice_service.js       # Deepgram Voice Agent logic
│   └── twilio_service.js      # Twilio call initiation + TwiML
├── repositories/
│   └── session_repository.js
├── script/
│   └── script.txt             # Call center script
├── public/
│   └── index.html             # Browser voice chat UI
└── .env.example


SETUP
-----
1. Install dependencies:
   cd server
   npm install

2. Configure environment:
   cp .env.example .env
   Then edit .env with your keys:
   - DEEPGRAM_API_KEY
   - TWILIO_ACCOUNT_SID (for phone calls)
   - TWILIO_AUTH_TOKEN
   - TWILIO_PHONE_NUMBER
   - NGROK_AUTH_TOKEN

3. Start the server:
   npm run dev


USAGE
-----
Browser Voice Chat:
  Open http://localhost:3000 and tap the call button.

Make an Outbound Call:
  curl -X POST http://localhost:3000/twilio/call \
    -H "Content-Type: application/json" \
    -d '{"to": "+91XXXXXXXXXX"}'


API ENDPOINTS
-------------
POST /voice/start       — Start a Deepgram voice session
POST /voice/stop        — Stop a session
POST /voice/inject      — Inject text into a session
GET  /voice/sessions    — List active sessions
POST /twilio/call       — Make an outbound phone call
POST /twilio/twiml      — TwiML endpoint (Twilio fetches this)


CALL FLOW
---------
Browser:
  Mic → AudioWorklet (24kHz PCM) → WebSocket → Server → Deepgram
  Deepgram → Server → WebSocket → AudioWorklet (resample) → Speaker

Twilio:
  POST /twilio/call → Twilio dials → Person answers
  → Twilio fetches TwiML → Opens Media Stream WS
  → Caller audio (mulaw 8kHz) → Deepgram Agent
  → Agent audio (mulaw 8kHz) → Caller's phone
