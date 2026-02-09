# Route Generation Flow — Walkthrough

Human-readable walkthrough of what happens from the moment **POST /api/generate** is hit until the client receives results. Includes all failure points (error / break / continue).

---

## 1. API layer (`POST /generate`)

1. **Request body is validated** (Zod: preferences, location, optional apiKeys, context).
   - **error;** If validation fails → 400, `VALIDATION_ERROR`, response stops.

2. **LLM and Maps providers are created** (ProviderFactory, using request apiKeys or env).
   - **error;** If provider creation fails → 503, `PROVIDER_ERROR`, response stops.

3. **Provider health checks** (LLM + Maps).
   - **error;** If either unhealthy → 503, `PROVIDER_UNAVAILABLE`, response stops.

4. **RouteOrchestrator is instantiated** (LLM, Maps, isAdvancedModel from apiKeys).

5. **orchestrator.generateRoute(preferences, location, context)** is called.
   - **error;** If it throws → 500, `ROUTE_GENERATION_FAILED`, response stops.

6. **Success:** Response is `{ routes: GeneratedRoute[] }`.

7. **finally:** Provider references are cleared (no retention of API keys).

---

## 2. Orchestrator — Step 1: Resolve location

1. **If `location.coordinates`** → use as origin; **continue** to Step 2.

2. **If `location.type === 'current'`** and no coordinates:
   - **error;** Throw: "Current location requires coordinates...". Pipeline stops.

3. **If `location.address`** → call **maps.geocode(address)** to get coordinates.
   - **error;** If geocode fails (e.g. network, invalid address), throw. Pipeline stops.

4. **Otherwise** (no coordinates, no address):
   - **error;** Throw: "Location must have coordinates or address". Pipeline stops.

---

## 3. Orchestrator — Step 2: Parse preferences

1. **PreferenceParser.parse(preferences)** is called (cached by pill set when enabled).

2. **parseWithLLM(preferences)** is tried first.
   - **error (caught);** If LLM fails (timeout, invalid JSON, etc.) → **continue** with fallback.
   - **continue;** Fallback: **parseWithRules(preferences)** (rule-based: keywords for distance, time, scenic, safety, POI types). No throw; pipeline continues with rule-based result.

3. **If preferences array is empty** (before parse):
   - **error;** Parser throws: "At least one preference pill is required". Pipeline stops.

4. **Result:** ParsedPreferences (hard/soft constraints, objectives, interpretations, ambiguities, confidence). **continue** to Step 3.

---

## 4. Orchestrator — Step 3: Compute search space

1. **Route type** is taken from context or default **WALK** (explore vs walk).

2. **Distance constraint** is taken from parsed hard constraints (first `type === 'distance'`), or **null** if none. Orchestrator guarantees a default distance constraint when none exists (so effectively always one).

3. **SpatialReasoner.computeSearchSpace(origin, distanceConstraint, routeType)** runs (sync).
   - Uses geolib for bounding box from center + radius.
   - Builds grid and reachability graph; returns boundary, grid, graph, metadata.

4. No failure path here; **continue** to Step 4.

---

## 5. Orchestrator — Step 4: Discover POIs

1. **Bounds** are derived from search space boundary (north, south, east, west).

2. **POIDiscoverer.discoverPOIs(bounds, parsedPreferences, MAX_POIS_DISCOVERED)** is called.

3. **extractPOITypes(preferences)** derives POI types from soft constraints (poi/scenic), interpretations, and ambiguities (keyword mapping so parser key variants still match).

4. **maps.findPOIs(bounds, poiTypes)** returns raw POIs.
   - **error;** If Maps API fails, discoverPOIs throws. Pipeline stops.

5. **densityBasedSampling(pois, maxPOIs, MIN_POI_SPACING_M)** caps and spaces POIs.

6. **Ranking:** Each POI gets a score (relevance, popularity, spatialFit, accessibility); sort by composite. **continue** to Step 5.

---

## 6. Orchestrator — Step 5: Strategic planning (LLM)

1. **StrategicPlanner.generateStrategy(parsedPreferences, pois, searchSpace, origin)** is called (Gemini).

2. **LLM** returns an **optimization strategy** (not a route): POI type priorities (weights per type), exploration style (concentrated vs dispersed), risk tolerance, diversity weight.

3. **error (caught);** If LLM fails → strategy fallback (default weights, balanced style). Pipeline continues; no throw.

4. **Result:** OptimizationStrategy. **continue** to Step 6.

---

## 7. Orchestrator — Step 6: Optimize waypoints (algorithm only)

1. **WaypointOptimizer.optimize(origin, parsedPreferences, searchSpace, pois, strategy, numFinalRoutes, routeType)** is called. **No LLM** in this step; the optimizer uses the strategy from Step 5.

2. **generateCandidatesAlgorithmic(...)** builds route candidates using the strategy:
   - Weights and style from strategy drive POI selection and ordering (e.g. nearest-neighbor with strategy-based weights).
   - Multiple candidates are produced (e.g. scenic, balanced, adventurous) by varying weights or ordering.

3. **evaluateRoute** for each candidate (distance match, scenic weight, safety, POI satisfaction, diversity).

4. **computeComposite** from preferences.objectives; sort by composite; **slice(0, numFinalRoutes)**.

5. **Result:** Array of OptimizedRoute (waypoints, objectives, composite, label). **continue** to Step 7.

---

## 8. Orchestrator — Step 7: Validate all candidates (Maps only, no LLM)

For **each** optimized route in order:

1. **If waypoints.length === 0** or **waypoints.length < MIN_WAYPOINTS:**
   - **continue;** Skip this candidate (warn, next optimized route).

2. **RouteValidator.validateRoute(waypoints, parsedPreferences, activity)** is called.
   - **Prechecks:** waypoints length ≥ 2; each waypoint has valid lat/lng (numbers, not NaN, lat in [-90,90], lng in [-180,180]).
   - **error (per attempt);** If precheck fails → return `{ valid: false, error: CONNECTIVITY_FAILURE, details }`. No retry.
   - **Private validate()** calls **maps.route(waypoints, activity)** to get directions.
   - **error (caught);** If Maps API throws → return `{ valid: false, error: API_ERROR, details }`. **Retry:** up to MAX_VALIDATION_RETRIES with backoff (only on API_ERROR). After retries exhausted → return last failure.
   - **Distance check:** If hard distance constraint exists and route distance is outside tolerance → return `{ valid: false, error: DISTANCE_MISMATCH }`. **break** (no retry).
   - **Elevation check:** If elevation constraint exists and elevation gain > max → return `{ valid: false, error: ELEVATION_EXCEEDED }`. **break** (no retry).
   - **Success:** return `{ valid: true, directions, metadata }`.

3. **If validation.valid && validation.directions:**
   - **calculateMetadata** (distance, duration, elevation_gain, activity, city, strategy). **inferCity** uses Nominatim reverse geocode; on failure → city = "Unknown".
   - Find **nearbyPOIs** (POIs within POI_NEARBY_THRESHOLD_M of the route path).
   - Push to **validatedCandidates** (id, optimized, route, metadata, waypoints, nearbyPOIs, activity).
   - **If validatedCandidates.length >= FINAL_ROUTES:** **break** out of loop.

4. **If validation failed** (valid: false) or **exception** during validation:
   - **continue;** Log warning, next optimized route.

5. **After loop:** If **validatedCandidates.length === 0:**
   - **error;** Throw: "Failed to generate any valid routes. Try adjusting your preferences or location." Pipeline stops.

---

## 9. Orchestrator — Step 8: Batch evaluate and build response (one LLM call)

1. **RouteEvaluator.evaluateRoutes(routeInputs, parsedPreferences, pois)** is called with **all** validated candidates.
   - **batchEvaluateWithLLM:** Single **LLM.generateJSON** with summaries of all routes; returns scenic score, safety score, POI satisfaction, summary, explanation, highlights per route.
   - **error (caught);** If LLM fails → **continue** with **templateEvaluation** per route (strategy-based scenic/safety, POI count, template narrative). No throw.

2. For **each** validated candidate, look up its **evaluation** (scores + narrative). Build **GeneratedRoute** (id, waypoints, route, metadata, scores, narrative, export, pois slice, created_at). **mapsExporter.generateExport(waypoints, activity)** for export data.

3. **Quality filter:** Compare compositeScore, keyMetricScore, distanceAccuracy to thresholds. If **does not meet** → push to **filteredRoutes**; **continue**. If **meets** → **validatedRoutes.push(generatedRoute)**.

4. **After processing all:**
   - **If validatedRoutes.length === 0 and filteredRoutes.length > 0:** Sort filtered by composite/keyMetric, return **best one** as fallback: `[ filteredRoutes[0].route ]`.
   - **If validatedRoutes.length === 0 and filteredRoutes.length === 0:** **error;** Throw: "Failed to generate any valid routes. Try adjusting your preferences or location."
   - **Otherwise:** Return **validatedRoutes**.

---

## 10. Back to API layer

1. **Success:** `res.json({ routes })` (array of GeneratedRoute).

2. **Error:** Any thrown error from orchestrator or earlier steps is passed to **next(error)** → error handler → appropriate status and JSON (e.g. 400, 503, 500).

---

## 11. Failure summary (quick reference)

| Where | Condition | Outcome |
|-------|-----------|---------|
| API | Request validation fails | **error;** 400, stop |
| API | Provider init fails | **error;** 503, stop |
| API | Health check fails | **error;** 503, stop |
| API | generateRoute throws | **error;** 500, stop |
| Resolve location | Current location without coords | **error;** throw, stop |
| Resolve location | Geocode fails / no address or coords | **error;** throw, stop |
| Parse preferences | Empty preferences | **error;** throw, stop |
| Parse preferences | LLM parse fails | **continue;** rule-based fallback |
| Discover POIs | Maps findPOIs fails | **error;** throw, stop |
| Strategic planning | LLM fails | **continue;** default strategy fallback |
| Optimize waypoints | No candidates generated | **error;** throw, stop |
| Validate route | Precheck (coords, count) fails | **continue;** skip candidate |
| Validate route | Maps route API fails | Retry up to N on API_ERROR; then **continue;** skip candidate |
| Validate route | Distance/elevation mismatch | **continue;** skip candidate |
| Batch evaluation | LLM fails | **continue;** template fallback per route |
| Quality filter | Route below thresholds | **continue;** add to filtered, skip to next |
| After all candidates | No valid and no filtered | **error;** throw, stop |
| After all candidates | No valid but have filtered | **break;** return best filtered as single route |

---

## 12. Data flow (simplified)

```
Request (preferences, location, context)
  → resolve location → origin (LatLng)
  → parse preferences → ParsedPreferences
  → compute search space → SearchSpace (bounds, grid, graph)
  → discover POIs → RankedPOI[]
  → strategic planning (LLM) → OptimizationStrategy
  → optimize waypoints (algorithm, guided by strategy) → OptimizedRoute[] (candidates)
  → for each candidate: validate → directions + metadata → validatedCandidates[]
  → RouteEvaluator.evaluateRoutes(validatedCandidates) → scores + narrative per route (1 LLM call)
  → build GeneratedRoute per candidate; quality filter → validatedRoutes or filteredRoutes
  → if any accepted: return validatedRoutes
  → else if any filtered: return [ best filtered ]
  → else throw
  → Response { routes: GeneratedRoute[] }
```

---

## 13. Google Maps API call count

When the Maps provider is **Google** (user supplies a Google Maps API key), these APIs are hit **per route-generation request**:

| API | Where | Count per request |
|-----|--------|--------------------|
| **Geocoding** | `maps.healthCheck()` (before generate) | **1** |
| **Geocoding** | `resolveLocation()` when user provides an address | **0 or 1** (0 if coordinates given) |
| **Places (searchNearby)** | `POIDiscoverer.discoverPOIs()` → `maps.findPOIs()` | **N** (one per POI type) |
| **Routes (computeRoutes)** | `RouteValidator.validateRoute()` → `maps.route()` per candidate | **1–3** (until we have enough valid routes) |
| **Elevation** | Not used in current flow (route has no elevation from Routes API) | **0** |

**POI types (N):** Extracted from preferences; default when none specified is 4 (`park`, `viewpoint`, `cafe`, `restaurant`). Max in code is 6 types (`cafe`, `park`, `viewpoint`, `restaurant`, `water`, `historical`). So **N = 4–6** in practice.

**Totals per request:**

- **User provides address:** 1 (health) + 1 (geocode) + (4–6) Places + (1–3) Routes = **7–11** Google API calls.
- **User provides coordinates:** 1 (health) + (4–6) Places + (1–3) Routes = **6–10** Google API calls.

*(City name in route metadata is inferred from coordinates when available.)*

---

*This walkthrough reflects the codebase (orchestrator, preference-parser, spatial-reasoner, poi-discoverer, strategic-planner, waypoint-optimizer, route-validator, route-evaluator, maps-exporter, API routes).*
