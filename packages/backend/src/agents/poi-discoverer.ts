import type { MapsProvider } from '../providers/maps/interface';
import { haversineDistance } from '@mappy/shared';
import { DISTANCE_CONSTANTS } from '../config/constants';
import type { BoundingBox, POI, POIType, RankedPOI, POIScore, ParsedPreferences } from '@mappy/shared';

export class POIDiscoverer {
  constructor(private maps: MapsProvider) { }

  /**
   * Discovers POIs within a given bounding box.
   * 
   * @param bounds - The bounding box to discover POIs within.
   * @param preferences - The preferences to use for discovering POIs.
   * @param maxPOIs - The maximum number of POIs to discover.
   * @param rawPreferenceTexts - Raw preference texts for fallback POI extraction.
   * @returns The discovered POIs.
   */
  async discoverPOIs(
    bounds: BoundingBox,
    preferences: ParsedPreferences,
    maxPOIs: number = 50,
    rawPreferenceTexts?: string[]
  ): Promise<RankedPOI[]> {
    const poiTypes = this.extractPOITypes(preferences, rawPreferenceTexts);
    console.log('[POIDiscoverer] Extracted POI types:', poiTypes.join(', '));

    // NEW: Log AI-extracted specific place names (infrastructure ready, search TODO)
    const specificPlaces = preferences.specific_places || [];
    if (specificPlaces.length > 0) {
      console.log('[POIDiscoverer] AI detected specific places:', specificPlaces.map(p => p.name).join(', '));
      console.log('[POIDiscoverer] Note: Specific place search requires Maps API enhancement. Using type-based discovery.');
    }

    // Search for POIs by type
    const pois = await this.maps.findPOIs(bounds, poiTypes);
    console.log('[POIDiscoverer] Maps API returned', pois.length, 'POIs by type');

    const ranked = pois.map(poi => ({
      ...poi,
      score: this.calculatePOIScore(poi, preferences),
    }));

    // Sort by score (relevance-first) before density sampling
    ranked.sort((a, b) => b.score.composite - a.score.composite);

    // Sample from the best ranked POIs to ensure diversity while keeping relevance
    const sampled = this.densityBasedSampling(ranked, maxPOIs, DISTANCE_CONSTANTS.MIN_POI_SPACING_M);

    // Log if no POIs found for specific types
    if (sampled.length === 0) {
      console.warn('[POIDiscoverer] No POIs found in this area. Try a different location or broader preferences.');
    }

    return sampled;
  }

  private static readonly POI_KEYWORDS: Array<{ type: POIType; keywords: string[] }> = [
    { type: 'cafe', keywords: ['cafe', 'coffee', 'breakfast', 'bakery', 'espresso', 'coffeeshop', 'tea', 'brunch'] },
    { type: 'park', keywords: ['park', 'garden', 'green', 'trail', 'playground'] },
    { type: 'viewpoint', keywords: ['viewpoint', 'view', 'lookout', 'vista', 'panorama', 'overlook'] },
    { type: 'restaurant', keywords: ['restaurant', 'food', 'dinner', 'lunch', 'dining', 'eat', 'cuisine'] },
    { type: 'water', keywords: ['water', 'lake', 'river', 'creek', 'pond', 'beach', 'waterfront', 'riverfront', 'canal', 'fountain', 'coast', 'shore', 'harbor'] },
    { type: 'historical', keywords: ['historical', 'historic', 'heritage', 'old', 'ancient', 'museum', 'monument', 'statue', 'landmark'] },
    { type: 'nature', keywords: ['nature', 'forest', 'woods', 'trees', 'wildlife', 'botanical'] },
    { type: 'landmark', keywords: ['landmark', 'monument', 'statue', 'tower', 'bridge', 'famous', 'historic'] },
    { type: 'scenic', keywords: ['scenic', 'beautiful', 'picturesque', 'pretty', 'aesthetic'] },
    { type: 'shopping', keywords: ['shopping', 'market', 'mall', 'store', 'shop', 'boutique', 'market'] },
    { type: 'entertainment', keywords: ['museum', 'gallery', 'theater', 'cinema', 'attraction', 'zoo', 'aquarium', 'museum'] },
  ];

  /**
   * Extracts POI types from preferences.
   * 
   * @param preferences - The preferences to extract POI types from.
   * @param rawPreferenceTexts - Raw preference texts for fallback extraction.
   * @returns The extracted POI types.
   */
  private extractPOITypes(preferences: ParsedPreferences, rawPreferenceTexts?: string[]): POIType[] {
    const types = new Set<POIType>();
    const allPOITypes: POIType[] = ['cafe', 'park', 'viewpoint', 'restaurant', 'water', 'scenic', 'historical', 'nature', 'landmark', 'shopping', 'entertainment'];

    // 1. Extract from soft POI constraints
    for (const constraint of preferences.constraints.soft) {
      if (constraint.type === 'poi' && constraint.preferences && typeof constraint.preferences === 'object') {
        const prefs = constraint.preferences as Record<string, unknown>;
        for (const key of Object.keys(prefs)) {
          // Skip internal/placeholder fields
          if (key === '_dynamic' || key.startsWith('_')) continue;
          
          const k = String(key).toLowerCase();
          if (allPOITypes.includes(k as POIType)) {
            types.add(k as POIType);
            continue;
          }
          for (const { type, keywords } of POIDiscoverer.POI_KEYWORDS) {
            if (keywords.some((kw) => k.includes(kw) || kw.includes(k))) {
              types.add(type);
              break;
            }
          }
        }
      }

      if (constraint.type === 'scenic') {
        types.add('viewpoint');
        types.add('park');
        types.add('water');
      }
    }

    // 2. Scan interpretations
    for (const interpretation of preferences.interpretations) {
      const text = JSON.stringify(interpretation).toLowerCase();
      for (const { type, keywords } of POIDiscoverer.POI_KEYWORDS) {
        if (keywords.some((kw) => text.includes(kw))) types.add(type);
      }
    }

    // 3. Check ambiguities
    const validPOITypes: POIType[] = POIDiscoverer.POI_KEYWORDS.map(({ type }) => type);
    for (const ambiguity of preferences.ambiguities) {
      if (ambiguity.field?.toLowerCase() !== 'poi') continue;
      for (const v of ambiguity.possibleValues ?? []) {
        const normalized = String(v).toLowerCase();
        if (validPOITypes.includes(normalized as POIType)) types.add(normalized as POIType);
      }
    }

    // 4. CRITICAL FALLBACK: Scan raw preference texts directly
    if (rawPreferenceTexts && rawPreferenceTexts.length > 0) {
      const rawText = rawPreferenceTexts.join(' ').toLowerCase();
      for (const { type, keywords } of POIDiscoverer.POI_KEYWORDS) {
        if (keywords.some((kw) => rawText.includes(kw))) {
          types.add(type);
        }
      }
    }

    if (types.size === 0) {
      return ['park', 'viewpoint', 'cafe', 'restaurant'];
    }

    return Array.from(types);
  }

  /**
   * Density-based sampling of POIs.
   * 
   * @param pois - The POIs to sample.
   * @param maxPOIs - The maximum number of POIs to sample.
   * @param minSpacingMeters - The minimum spacing between POIs.
   * @returns The sampled POIs.
   */
  private densityBasedSampling(pois: RankedPOI[], maxPOIs: number, minSpacingMeters: number): RankedPOI[] {
    if (pois.length <= maxPOIs) return pois;

    const sampled: RankedPOI[] = [];
    const used = new Set<string>();

    // Input is already sorted by composite score (relevance-first)
    for (const poi of pois) {
      if (sampled.length >= maxPOIs) break;

      let tooClose = false;
      for (const existing of sampled) {
        const distance = haversineDistance(poi.location, existing.location);
        if (distance < minSpacingMeters) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose && !used.has(poi.id)) {
        sampled.push(poi);
        used.add(poi.id);
      }
    }

    return sampled;
  }

  /**
   * Calculates the score of a POI.
   * 
   * @param poi - The POI to score.
   * @param preferences - The preferences to use for scoring.
   * @returns The score of the POI.
   */
  private calculatePOIScore(poi: POI, preferences: ParsedPreferences): POIScore {
    const relevance = this.calculateRelevance(poi, preferences);
    const popularity = (poi.rating || 3) / 5 * 10;
    const spatialFit = this.calculateSpatialFit(poi);
    const accessibility = this.calculateAccessibility(poi);
    const temporal = 5;

    const composite = (
      relevance * 0.7 +
      popularity * 0.1 +
      spatialFit * 0.1 +
      accessibility * 0.1
    );

    return {
      relevance,
      popularity,
      spatialFit,
      accessibility,
      temporal,
      composite,
    };
  }

  /**
   * Relevance of a POI to preferences. Uses same keyword mapping as extractPOITypes
   * so parser key variants (e.g. "coffee") still boost matching types (e.g. "cafe").
   */
  private calculateRelevance(poi: POI, preferences: ParsedPreferences): number {
    let score = 5;
    const poiType = poi.type.toLowerCase();

    for (const constraint of preferences.constraints.soft) {
      if (constraint.type === 'poi' && constraint.preferences && typeof constraint.preferences === 'object') {
        const prefs = constraint.preferences as Record<string, number>;
        let matchWeight = 0;
        for (const key of Object.keys(prefs)) {
          const k = key.toLowerCase();
          const w = prefs[key] ?? 0.5;
          if (k === poiType) {
            matchWeight = Math.max(matchWeight, w);
            continue;
          }
          for (const { type, keywords } of POIDiscoverer.POI_KEYWORDS) {
            if (type === poi.type && keywords.some((kw) => k.includes(kw) || kw.includes(k))) {
              matchWeight = Math.max(matchWeight, w);
              break;
            }
          }
        }
        if (matchWeight > 0) score += matchWeight * 4;
      }

      if (constraint.type === 'scenic' && ['viewpoint', 'park', 'water'].includes(poi.type)) {
        score += constraint.weight * 5;
      }
    }

    return Math.min(10, score);
  }

  /**
   * Spatial fit of a POI to preferences.
   * 
   * @param poi - The POI to calculate the spatial fit of.
   * @returns The spatial fit of the POI.
   */
  private calculateSpatialFit(poi: POI): number {
    const typeWeights: Record<string, number> = {
      park: 9,
      viewpoint: 9,
      water: 8,
      historical: 7,
      cafe: 5,
      restaurant: 5,
    };
    return typeWeights[poi.type] || 6;
  }

  /**
   * Accessibility of a POI.
   * 
   * @param poi - The POI to calculate the accessibility of.
   * @returns The accessibility of the POI.
   */
  private calculateAccessibility(poi: POI): number {
    const typeWeights: Record<string, number> = {
      cafe: 10,
      restaurant: 10,
      historical: 8,
      park: 7,
      viewpoint: 5,
    };
    return typeWeights[poi.type] || 7;
  }

  /**
   * Filter POIs that are close to a route path.
   * 
   * @param pois - The POIs to filter.
   * @param routePath - The route path to filter POIs near.
   * @param maxDistanceMeters - The maximum distance to consider a POI "nearby".
   * @returns The filtered POIs.
   */
  filterPOIsNearPath(
    pois: RankedPOI[],
    routePath: [number, number][],
    maxDistanceMeters: number = DISTANCE_CONSTANTS.POI_NEARBY_THRESHOLD_M
  ): RankedPOI[] {
    if (!routePath || routePath.length === 0) return pois;

    return pois.filter(poi => {
      let minDistance = Infinity;
      for (const coord of routePath) {
        const distance = haversineDistance(poi.location, { lng: coord[0], lat: coord[1] });
        if (distance < minDistance) minDistance = distance;
        if (minDistance < maxDistanceMeters) return true;
      }
      return false;
    });
  }

  /**
   * Select POIs with good route coverage.
   */
  selectPOIsWithCoverage(
    pois: RankedPOI[],
    routePath: [number, number][],
    targetCount: number = 5
  ): RankedPOI[] {
    if (!routePath || routePath.length === 0 || pois.length === 0) {
      return pois.slice(0, targetCount);
    }

    const segments = targetCount;
    const segmentSize = Math.floor(routePath.length / segments);
    const selected: RankedPOI[] = [];
    const used = new Set<string>();

    for (let i = 0; i < segments; i++) {
      const segStart = i * segmentSize;
      const segEnd = (i + 1) * segmentSize;
      const segmentCoords = routePath.slice(segStart, segEnd);

      let bestPoi: RankedPOI | null = null;
      let bestScore = -1;

      for (const poi of pois) {
        if (used.has(poi.id)) continue;

        const isNearSegment = segmentCoords.some(c =>
          haversineDistance(poi.location, { lng: c[0], lat: c[1] }) < DISTANCE_CONSTANTS.POI_NEARBY_THRESHOLD_M
        );

        if (isNearSegment && poi.score.composite > bestScore) {
          bestScore = poi.score.composite;
          bestPoi = poi;
        }
      }

      if (bestPoi) {
        selected.push(bestPoi);
        used.add(bestPoi.id);
      }
    }

    if (selected.length < targetCount) {
      const remaining = pois
        .filter(p => !used.has(p.id))
        .sort((a, b) => b.score.composite - a.score.composite)
        .slice(0, targetCount - selected.length);
      selected.push(...remaining);
    }

    return selected;
  }
}
