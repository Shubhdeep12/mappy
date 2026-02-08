# Mappy

**AI-powered route planner for exploration, not navigation.**

Generate personalized walking routes from natural language preferences. Instead of optimizing for speed, Mappy optimizes for experience—scenic quality, points of interest, and what you actually want.

| Link | URL |
|------|-----|
| Demo video | [YouTube](https://youtu.be/ZYh7azK2g7k?si=uzEJpBLbX3uFBNR1) |
| Repository | (this repo) |
| Live demo | (add deployed app URL when available) |

---

## The Problem

You're visiting a new city with 2 hours to explore. Google Maps is perfect for getting from A to B, but what if you don't have a destination? What if you just want a scenic 4-mile walk that hits parks and coffee shops?

Traditional maps can't solve this. **Mappy can.**

---

## How It Works

```
"4 mile scenic walk with viewpoints and specialty coffee"
                        ↓
        [ 7-Agent AI-Guided Pipeline ]
                        ↓
    3 optimized routes with turn-by-turn directions
```

### AI-guided hybrid architecture

Mappy uses **AI-guided algorithmic optimization**:

1. **Gemini Strategic Planner** uses your preferences and 100 discovered POIs to produce an optimization strategy.
2. A **deterministic optimizer** uses that strategy to generate 3 distinct routes (fast, no token limits).
3. **Gemini Route Evaluator** scores routes and writes short summaries.

AI alone hits token limits with 100 POIs; pure algorithms don’t understand “scenic walk with viewpoints.” Mappy uses Gemini for strategy and algorithms for execution.

See [GEMINI_INTEGRATION.md](./docs/GEMINI_INTEGRATION.md) for Gemini usage details.

---

## Features

- **Natural language preferences** — e.g. "5 miles, scenic, with coffee shops"
- **POI discovery** — up to 100 places from Google Maps
- **AI-guided optimization** — Gemini for strategy, algorithms for route construction
- **Three route variants** — Scenic, Balanced, Adventurous
- **Export** — open routes in Google Maps or Apple Maps
- **Dual mode** — Gemini + Google Maps, or local (Ollama + OpenStreetMap)

---

## Setup

**Prerequisites:** Node.js 20+ (22+ recommended), pnpm 9+

### Option A: One-command setup (recommended)

```bash
git clone https://github.com/<your-username>/mappy.git
cd mappy
pnpm setup
pnpm dev
```

`pnpm setup` installs dependencies and copies `packages/backend/.env.example` and `packages/frontend/.env.example` to `.env` in each package if you don’t already have a `.env` there.

### Option B: Manual setup

```bash
git clone https://github.com/<your-username>/mappy.git
cd mappy
pnpm install
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env
pnpm dev
```

### Run the app

- **Backend** runs on `http://localhost:8080`, **frontend** on `http://localhost:3000` (or the port Vite prints).
- Open the frontend URL in the browser. In the app, add **Gemini** and **Google Maps** API keys in Settings to use full features, or use **free mode** (Ollama + OpenStreetMap) with no keys.

### API keys (optional for full features)

- **Gemini API** — [Google AI Studio](https://aistudio.google.com/apikey)
- **Google Maps API** — [Google Cloud Console](https://console.cloud.google.com/) (enable Routes, Places, Geocoding APIs)

Without keys, the app can run in free mode (Ollama + OSM) if you run [Ollama](https://ollama.ai) locally.

---

## Architecture

**7-Agent Pipeline:**

```
User Input → 1. Preference Parser (AI)
           → 2. Spatial Reasoner (Algorithm)
           → 3. POI Discoverer (Algorithm) → 100 POIs
           → 4. Strategic Planner (AI) → Optimization strategy
           → 5. Waypoint Optimizer (Algorithm + AI guidance) → 3 routes
           → 6. Route Validator (Maps API)
           → 7. Route Evaluator (AI) → Scores + narratives
```

Strategic Planner (Gemini) outputs a strategy; the Waypoint Optimizer (pure code) turns it into routes.

See [docs/ROUTE_GENERATION_FLOW.md](./docs/ROUTE_GENERATION_FLOW.md) for the full request flow.

---

## Project Structure

```
mappy/
├── packages/
│   ├── backend/      # Express API, 7 agents, orchestrator, providers
│   ├── frontend/     # React app, route map, preference input
│   └── shared/       # TypeScript types, validation schemas
├── docs/
│   ├── GEMINI_INTEGRATION.md
│   └── ROUTE_GENERATION_FLOW.md
└── README.md
```

---

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS  
**Backend:** Node.js, Express, TypeScript  
**AI:** Gemini 3 (structured JSON output)  
**Maps:** Google Maps (Routes, Places, Geocoding APIs)  
**Dev Mode:** Ollama (gemma3:1b) + OpenStreetMap

---


## Roadmap

- [x] 7-agent AI-guided pipeline
- [x] Natural language preference parsing
- [x] POI discovery (100 POIs per request)
- [x] Strategic Planner for AI-guided optimization
- [x] Gemini + Google Maps integration
- [x] Export to Google/Apple Maps
- [ ] Beam search (replace nearest-neighbor)
- [ ] Priority regions from Strategic Planner
- [ ] Weather and time-of-day awareness
- [ ] GPX export
- [ ] Cycling and running modes

---

## Third-Party Integrations

This project uses:

- **Google Gemini API** — LLM for preference parsing, strategic planning, and route evaluation ([terms](https://ai.google.dev/terms)).
- **Google Maps APIs** — Routes, Places, and Geocoding ([terms](https://cloud.google.com/maps-platform/terms)).

Both are used in accordance with their respective terms. Optional local mode uses Ollama and OpenStreetMap.

---

## License

MIT License. See [LICENSE](./LICENSE) in the repository root.

---

## Acknowledgments

Built for the Google Gemini API Developer Competition.

Gemini handles preference parsing, strategic planning, and route evaluation. Google Maps supplies routes, places, and geocoding.
