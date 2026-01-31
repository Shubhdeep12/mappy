# Mappy System Design - Core Architecture

## Route Generation Pipeline

```mermaid
flowchart TD
    Start([🚶 User: "5 mile scenic walk with coffee"]) --> Parser

    subgraph Agent1["Agent 1: Preference Parser"]
        Parser[Parse natural language]
        Parser --> LLM1[🤖 LLM: Extract constraints]
        LLM1 --> Constraints[Distance: 5mi, Scenic: high, POI: cafe]
    end

    Constraints --> Spatial

    subgraph Agent2["Agent 2: Spatial Reasoner"]
        Spatial[Compute search area]
        Spatial --> Grid[Build walkable grid]
    end

    Grid --> POI

    subgraph Agent3["Agent 3: POI Discoverer"]
        POI[Query Maps API]
        POI --> Rank[Rank by relevance + spacing]
    end

    Rank --> Waypoint

    subgraph Agent4["Agent 4: Waypoint Optimizer ⭐"]
        Waypoint[Generate route candidates]
        Waypoint --> LLM2[🤖 LLM: Create waypoint sequences]
        LLM2 --> Eval[Evaluate: distance, scenic, safety]
        Eval --> Select[Select best 3 diverse routes]
    end

    Select --> Validate

    subgraph Agent5["Agent 5: Route Validator"]
        Validate[Get actual route]
        Validate --> Maps[📍 Maps API: Calculate path]
        Maps --> Check{Distance OK?}
        Check -->|No| Validate
        Check -->|Yes| Valid[Valid route]
    end

    Valid --> Evaluate

    subgraph Agent6["Agent 6: Route Evaluator"]
        Evaluate[Batch evaluate all routes]
        Evaluate --> LLM3[🤖 LLM: Scores + narrative per route]
        LLM3 --> Scores[Scenic, Safety, POI, Summary, Highlights]
    end

    Scores --> Response([📱 Return: Route + Scores + Narrative])

    style Agent4 fill:#ffe0e0,stroke:#ff0000,stroke-width:2px
    style LLM1 fill:#e3f2fd
    style LLM2 fill:#e3f2fd
    style LLM3 fill:#e3f2fd
    style Maps fill:#e8f5e9
```

## Key Points

| Agent | Input | LLM? | Output |
|-------|-------|------|--------|
| **Preference Parser** | "5 mile scenic walk" | ✅ | `{distance: 5mi, scenic: high}` |
| **Spatial Reasoner** | Constraints + location | ❌ | Walkable grid bounds |
| **POI Discoverer** | Bounds + POI types | ❌ | Ranked cafes, parks |
| **Waypoint Optimizer** | Grid + POIs + constraints | ✅ | 3 diverse route candidates |
| **Route Validator** | Waypoints | ❌ | Actual route from Maps API |
| **Route Evaluator** | All validated routes | ✅ | Scenic, safety, POI scores + narrative per route (1 call) |

## Provider Switch

```
API Keys provided?
  ├── Yes → Gemini + Google Maps (Premium)
  └── No  → Ollama + OSM (Free)
```
