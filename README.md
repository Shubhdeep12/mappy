# Mappy – AI-Powered Waypoint Route Planner

**Natural language route planning powered by multi-agent AI**

Generate personalized walking (or biking) routes by describing what you want: *"5 miles, scenic, with coffee shops"*.

---

## What Mappy Does

Mappy turns natural language preferences into **ready-to-follow routes** with waypoints, scores, and a short narrative.

- **Input:** Preferences (e.g. distance, scenic, POIs like cafes/parks), location (address or coordinates), and route type (loop vs point-to-point).
- **Output:** Up to 3 route options, each with:
  - Waypoints and full turn-by-turn geometry
  - Scenic, safety, and POI satisfaction scores
  - Distance and elevation summary
  - A short summary, explanation, and highlights
  - Deep links (Google Maps, Apple Maps, etc.)

Unlike "shortest path only" planners, Mappy uses **6 specialized agents** and an LLM to optimize for your stated goals (scenic quality, safety, POIs, distance accuracy) and return diverse, high-quality options.

---

## How Gemini 3 Is Used

When you provide a **Gemini API key** (Premium mode), Mappy uses **Gemini 3 (e.g. `gemini-3.0-flash`)** as the LLM backend. Gemini is used only where language and reasoning matter:

| Use | Role |
|-----|------|
| **Preference parsing** | Turn free-text pills into structured constraints (distance, scenic weight, POI types). |
| **Waypoint optimization** | Propose and rank waypoint sequences that balance scenic, safety, POI, and distance. |
| **Route evaluation** | Batch score all routes (scenic, safety, POI satisfaction) and generate summary, explanation, and highlights per route in one call. |

All Gemini calls use **structured JSON output** (and optional thinking/grounding where configured). No user API keys are logged or persisted on the server; providers that hold keys are created per request and released when the request finishes.

---

## Architecture (Multi-Agent Flow)

Route generation is a **linear pipeline** of 6 agents. Maps/LLM providers are swappable (Ollama + OSM vs Gemini + Google Maps).

```
User: preferences + location + route type
        │
        ▼
┌─────────────────────────┐
│ 1. Preference Parser   │  LLM: natural language → constraints, objectives
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 2. Spatial Reasoner     │  Compute search area / grid from distance & route type
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 3. POI Discoverer       │  Maps API: fetch POIs in bounds, rank by relevance
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 4. Waypoint Optimizer   │  LLM + scoring: candidate waypoint sequences → best N
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 5. Route Validator      │  Maps API: get real route geometry for each candidate
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 6. Route Evaluator      │  LLM (1 call): score all routes + narrative; or template fallback
└───────────┬─────────────┘
            ▼
Response: routes (waypoints, geometry, scores, narrative, export links)
```

- **Agents 1, 4, 6** use the LLM (Gemini in Premium mode).
- **Agents 2, 3, 5** are deterministic (spatial math, maps APIs).  
The orchestrator runs these steps in order, filters by quality, and returns the best routes (or a fallback).

---

## How to Run (Gemini Mode – Premium)

Uses **your** Gemini and Google Maps API keys (provided in the UI). No keys are stored on the server.

**Prerequisites:** Node.js 22+, pnpm 9+

```bash
git clone <repo-url>
cd mappy
pnpm install
```

**Backend:**

```bash
cd packages/backend
cp .env.example .env   # edit if you need non-default port etc.
pnpm dev
```

**Frontend (separate terminal):**

```bash
cd packages/frontend
cp .env.example .env
pnpm dev
```

Open the app (e.g. http://localhost:5173), go to **"API Keys (Optional)"** (or "Use Your Own API Keys"), and add:

- [Gemini API key](https://aistudio.google.com/app/apikey)
- [Google Maps API key](https://console.cloud.google.com/google/maps-apis) (Routes, Places, Geocoding as needed)

Then generate a route; the backend will use Gemini 3 and Google Maps for that request only, and will not log or persist your keys.

---

## How to Run (Local Mode – Free)

Runs fully locally with **Ollama** (LLM) and **OpenStreetMap** (routing/geocoding). No API keys required.

**1. Install and run Ollama**

```bash
# macOS
brew install ollama
ollama pull gemma2:2b   # or another small model
ollama serve
```

**2. Start backend and frontend** (same as above; use default `.env` in `packages/backend` so no Gemini/Google keys are set).

**3. Use the app** without entering any API keys. The backend falls back to Ollama + OSM.

---

## Roadmap

### ✅ Completed

- [x] Multi-agent pipeline (preference → waypoints → validation → scores → narrative)
- [x] Preference parser (LLM) + spatial reasoner + POI discoverer
- [x] Waypoint optimizer with LLM + multi-objective scoring
- [x] Route validator (real geometry from Maps API)
- [x] Route evaluator (batch scenic + safety + narrative in one LLM call; template fallback)
- [x] Gemini 3 + Google Maps (Premium) and Ollama + OSM (Local) modes
- [x] API keys only via UI; no server-side storage or logging of keys

### 🧠 Core Intelligence

- [ ] **POI RAG enrichment** – Retrieve rich context (OSM tags, Wikipedia summaries) per POI for smarter waypoint selection
- [ ] **Gemini embeddings** – Semantic search over POI descriptions to match user preferences
- [ ] **Time-of-day and weather context** – Context-aware safety and scenic scoring
- [ ] **Activity-aware routing** – Walking / running / biking mode selection with appropriate constraints

### 🛠️ Developer Experience

- [ ] **MCP server** – Model Context Protocol server for AI assistant integration (Cursor, Claude Desktop)
- [ ] **CLI tool** – Command-line interface for route generation (`mappy generate --location "NYC" --preferences "scenic 3mi"`)
- [ ] **Agentic orchestrator mode** – LLM-driven tool selection with retry and clarification loops

### 📤 Export & Integration

- [ ] **GPX download** – Export routes as GPX files for GPS devices
- [ ] **Static map preview** – Shareable image URL for routes
- [ ] **Place ID support** – Google Places deep linking ("start at this place")

### 🎨 User Experience

- [ ] Preference pill priority (e.g. "must have" vs "nice to have")
- [ ] Trade-offs explanation in narrative (e.g. "Prioritized safety over scenic")
- [ ] Route label badges (e.g. "🌿 Scenic" / "⚖️ Balanced" / "🛡️ Safe")

---

## Monorepo Layout

```
mappy/
├── packages/
│   ├── backend/    # API, agents, orchestrator, providers (LLM + Maps)
│   ├── frontend/   # React UI, route map, preference pills, API key form
│   └── shared/     # Types, validation schemas, constants
├── README.md
└── SYSTEM_DESIGN.md
```

See **SYSTEM_DESIGN.md** for pipeline diagrams and provider switch (API keys → Gemini + Google Maps vs default → Ollama + OSM).
