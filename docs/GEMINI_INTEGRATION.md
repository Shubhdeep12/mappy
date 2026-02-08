# Gemini Integration in Mappy

Mappy uses **Gemini 3** across three agents in its 7-agent route generation pipeline.

## How Gemini is used

### 1. Preference Parser
Users type things like "5 mile scenic walk with viewpoints and coffee shops." Gemini extracts structured constraints: distance, scenic weight, safety preferences, POI types. We use **structured JSON output** so the rest of the pipeline gets consistent data.

### 2. Strategic Planner
Given 100 discovered POIs and user preferences, Gemini returns an **optimization strategy** instead of a full route (which would hit token limits):

- POI type priorities (weights 0-2 for each type: viewpoints, parks, cafes, etc.)
- Exploration style (concentrated vs dispersed)
- Risk tolerance (willingness to explore farther)
- Diversity weight (variety vs best-scoring POIs)

That strategy drives a deterministic optimizer that builds three route candidates from all 100 POIs.

### 3. Route Evaluator
After routes are validated with Google Maps, Gemini scores each route (scenic quality, safety, POI fit) and writes short summaries so users get more than raw scores.

## Why Gemini is central

Gemini does the parts that need language and strategy: understanding "scenic" and "viewpoints," and choosing priorities. The rest (spatial optimization over 100 POIs) is done by code so we avoid token limits and keep latency low. All three agents use **structured output** and **JSON schema** so responses are reliable.
