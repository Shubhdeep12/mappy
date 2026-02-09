/** Parses preference pills into structured constraints (LLM with rule-based fallback). */

import type { LLMProvider } from '../providers/llm/interface.js';
import type { PreferencePill, ParsedPreferences, HardConstraint, SoftConstraint, Objective, Ambiguity, ConfidenceScore, ContextMetadata } from '@mappy/shared';

export class PreferenceParser {
  constructor(private llm: LLMProvider) { }

  async parse(preferences: PreferencePill[], context?: ContextMetadata): Promise<ParsedPreferences> {
    if (preferences.length === 0) {
      throw new Error('At least one preference pill is required');
    }

    try {
      return await this.parseWithLLM(preferences, context);
    } catch (error) {
      console.warn('[PreferenceParser] LLM parsing failed, falling back to rule-based parser:', error);
      return this.parseWithRules(preferences, context);
    }
  }

  private async parseWithLLM(preferences: PreferencePill[], context?: ContextMetadata): Promise<ParsedPreferences> {
    const prompt = this.buildPrompt(preferences);
    const preferredUnit = context?.preferredDistanceUnit === 'km' ? 'km' : 'miles';

    const schema = {
      type: 'object',
      properties: {
        constraints: {
          type: 'object',
          properties: {
            hard: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['distance', 'time', 'elevation', 'boundary'] },
                  value: { type: 'number' },
                  unit: { type: 'string' },
                  source: { type: 'string' },
                },
                required: ['type', 'value', 'unit', 'source'],
              },
            },
            soft: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['scenic', 'safety', 'poi', 'surface'] },
                  weight: { type: 'number', minimum: 0, maximum: 1 },
                  preferences: {
                    type: 'object',
                    description: 'Dynamic preferences object (e.g. POI types with weights). Do NOT use "_dynamic" as a key.',
                  },
                  negotiable: { type: 'boolean' },
                },
                required: ['type', 'weight', 'preferences', 'negotiable'],
              },
            },
          },
          required: ['hard', 'soft'],
        },
        objectives: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              weight: { type: 'number', minimum: 0, maximum: 1 },
              metric: { type: 'string' },
              direction: { type: 'string', enum: ['maximize', 'minimize'] },
            },
            required: ['name', 'weight', 'metric', 'direction'],
          },
        },
        interpretations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              scenario: { type: 'string' },
              probability: { type: 'number', minimum: 0, maximum: 1 },
              constraints: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' }
                  }
                }
              },
            },
            required: ['scenario', 'probability', 'constraints'],
          },
        },
        confidence: {
          type: 'object',
          properties: {
            overall: { type: 'number', minimum: 0, maximum: 1 },
            byField: {
              type: 'object',
              description: 'Confidence scores per field (e.g. {"distance": 0.95, "scenic": 0.8})',
            },
          },
          required: ['overall', 'byField'],
        },
        ambiguities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              possibleValues: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['field', 'possibleValues', 'confidence'],
          },
        },
        specific_places: {
          type: 'array',
          description: 'Specific named places mentioned (e.g. "India Gate", "Blue Tokai Cafe")',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              priority: { type: 'number', minimum: 1, maximum: 10 },
            },
            required: ['name'],
          },
        },
      },
      required: ['constraints', 'objectives', 'interpretations', 'confidence', 'ambiguities'],
    };

    const result = await this.llm.generateJSON<Partial<ParsedPreferences>>(prompt, schema, {
      systemInstruction: `You are a spatial constraint reasoner for Mappy route generation.

Parse user preferences into structured constraints and objectives.

CONSTRAINT TYPES:
1. HARD (strict): distance, time, elevation, boundary
   - If NO distance specified → add default 5 ${preferredUnit} hard constraint

2. SOFT (preferences with weights 0-1):
   - scenic: architectural, beautiful, nature, views, peaceful
   - safety: well-lit, populated, sidewalks
   - poi: ANY place type (restaurants, shops, parks, museums, cafes, ramen shops, bakeries, etc.)
   - surface: paved, trail, mixed

POI EXTRACTION:
- "ramen shop" → poi type: restaurant + ramen (both important)
- "traditional architecture" → scenic preference with cultural interest
- "coffee shops" → poi type: cafe
- "museums and parks" → poi types: museum + park
- Extract ALL mentioned POI types, don't limit

OBJECTIVES:
- Add objectives matching soft constraints (poi_satisfaction, scenic_quality, safety_score)
- Weight based on emphasis in user input

SPECIFIC PLACES:
- Proper nouns only: "India Gate", "Blue Tokai Cafe", "Starbucks on Main St"
- NOT generic: "ramen shop", "a cafe", "parks"

CONFIDENCE:
- High (0.7-0.9): clear, specific preferences
- Medium (0.5-0.7): somewhat vague
- Low (0.3-0.5): very ambiguous`,
      // thinking: true,
      temperature: 0.1,
      maxTokens: 4096,
    });

    if (!result || typeof result !== 'object') {
      throw new Error('LLM returned invalid or null result');
    }

    return this.normalizeParsedPreferences(result);
  }

  private buildPrompt(preferences: PreferencePill[]): string {
    const pills = preferences.map((p, i) => `${i + 1}. "${p.text}"`).join('\n');

    return `Parse these user preferences for route generation:

${pills}

CONTEXT: User wants a walking/exploring route. Each preference pill can specify:
- Distance/time (e.g. "5 miles", "30 minutes")
- POI types they want to visit (e.g. "cafes", "ramen shop", "historical sites")
- Route qualities (e.g. "scenic", "safe", "quiet")
- Specific named places (e.g. "India Gate", "Blue Tokai Cafe")

IMPORTANT:
- POI-related terms (restaurant types, landmarks, shops, etc.) should create soft constraints with type='poi'
- If no distance specified, add default: 5 miles hard constraint
- Extract all POI types mentioned (restaurant, ramen, coffee shop, park, museum, etc.)
- Architectural/cultural terms ("traditional architecture") suggest scenic/cultural preferences`;
  }

  private normalizeParsedPreferences(result: Partial<ParsedPreferences>): ParsedPreferences {
    const normalized: ParsedPreferences = {
      constraints: {
        hard: Array.isArray(result.constraints?.hard) ? result.constraints.hard : [],
        soft: Array.isArray(result.constraints?.soft) ? result.constraints.soft : [],
      },
      objectives: Array.isArray(result.objectives) ? result.objectives : [],
      interpretations: Array.isArray(result.interpretations) ? result.interpretations : [],
      ambiguities: Array.isArray(result.ambiguities) ? result.ambiguities : [],
      specific_places: Array.isArray(result.specific_places) ? result.specific_places : undefined,
      confidence: {
        overall: typeof result.confidence?.overall === 'number'
          ? Math.max(0, Math.min(1, result.confidence.overall))
          : 0.5,
        byField: this.normalizeByField(result.confidence?.byField),
      },
    };

    if (normalized.objectives.length > 0) {
      const totalWeight = normalized.objectives.reduce((sum, obj) => sum + (obj.weight || 0), 0);
      if (totalWeight > 0) {
        normalized.objectives = normalized.objectives.map(obj => ({
          ...obj,
          weight: obj.weight / totalWeight,
        }));
      }
    }

    return normalized;
  }

  private normalizeByField(byField: unknown): Record<string, number> {
    if (!byField || typeof byField !== 'object' || Array.isArray(byField)) {
      return {};
    }

    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(byField)) {
      if (typeof value === 'number' && !isNaN(value)) {
        normalized[key] = Math.max(0, Math.min(1, value));
      }
    }

    return normalized;
  }

  private parseWithRules(preferences: PreferencePill[], context?: ContextMetadata): ParsedPreferences {
    const hard: HardConstraint[] = [];
    const soft: SoftConstraint[] = [];
    const objectives: Objective[] = [];
    const ambiguities: Ambiguity[] = [];
    const confidence: ConfidenceScore = {
      overall: 0.6,
      byField: {},
    };

    for (const pill of preferences) {
      const text = pill.text.toLowerCase();

      const distanceMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:mile|miles|mi|km|kilometer|kilometers|k)\b/);
      if (distanceMatch) {
        let distance = parseFloat(distanceMatch[1]);
        const unit = text.includes('km') || text.includes('kilometer') || text.match(/\d+\s*k\b/) ? 'km' : 'miles';
        if (unit === 'km') {
          distance = distance * 0.621371;
        }
        hard.push({
          type: 'distance',
          value: distance,
          unit: 'miles',
          source: pill.text,
        });
        confidence.byField.distance = 0.8;
      }

      const timeMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minute|minutes|min|mins|hour|hours|hr|hrs)/);
      if (timeMatch && !distanceMatch) {
        const timeValue = parseFloat(timeMatch[1]);
        const isHours = text.includes('hour') || text.includes('hr');
        const minutes = isHours ? timeValue * 60 : timeValue;

        const estimatedMiles = (minutes / 60) * 3;
        hard.push({
          type: 'time',
          value: minutes,
          unit: 'minutes',
          source: pill.text,
        });
        hard.push({
          type: 'distance',
          value: estimatedMiles,
          unit: 'miles',
          source: `estimated from ${pill.text}`,
        });
        confidence.byField.time = 0.7;
        confidence.byField.distance = 0.6;
      }

      if (text.includes('scenic') || text.includes('beautiful') || text.includes('view') ||
        text.includes('nature') || text.includes('green') || text.includes('pretty') ||
        text.includes('peaceful') || text.includes('quiet') || text.includes('relaxing')) {
        soft.push({
          type: 'scenic',
          weight: 0.8,
          preferences: { scenic: 1.0 },
          negotiable: true,
        });
        objectives.push({
          name: 'scenic_quality',
          weight: 0.7,
          metric: 'scenic_score',
          direction: 'maximize',
        });
        confidence.byField.scenic = 0.7;
      }

      if (text.includes('safe') || text.includes('safety') || text.includes('well-lit') ||
        text.includes('lit') || text.includes('populated') || text.includes('busy') ||
        text.includes('sidewalk') || text.includes('night')) {
        soft.push({
          type: 'safety',
          weight: 0.8,
          preferences: { safety: 1.0 },
          negotiable: true,
        });
        objectives.push({
          name: 'safety_score',
          weight: 0.6,
          metric: 'safety_score',
          direction: 'maximize',
        });
        confidence.byField.safety = 0.7;
      }

      const poiKeywords: Record<string, string[]> = {
        cafe: ['cafe', 'coffee', 'coffeeshop', 'espresso', 'bakery'],
        park: ['park', 'garden', 'green', 'nature', 'trail'],
        restaurant: ['restaurant', 'food', 'eat', 'dining', 'lunch', 'dinner'],
        viewpoint: ['viewpoint', 'lookout', 'overlook', 'vista', 'panorama'],
        water: ['water', 'lake', 'river', 'creek', 'pond', 'beach', 'waterfront'],
        historical: ['historical', 'historic', 'monument', 'landmark', 'museum'],
        shopping: ['shopping', 'shop', 'mall', 'store', 'boutique', 'retail', 'market'],
        scenic: ['scenic', 'view', 'vista', 'overlook', 'observation'],
        landmark: ['landmark', 'attraction', 'site', 'destination'],
      };

      const matchedPOITypes: string[] = [];
      for (const [poiType, keywords] of Object.entries(poiKeywords)) {
        if (keywords.some(kw => text.includes(kw))) {
          matchedPOITypes.push(poiType);
        }
      }

      if (matchedPOITypes.length > 0) {
        const poiPrefs: Record<string, number> = {};
        matchedPOITypes.forEach(type => poiPrefs[type] = 1.0);

        soft.push({
          type: 'poi',
          weight: 0.7,
          preferences: poiPrefs,
          negotiable: true,
        });
        objectives.push({
          name: 'poi_satisfaction',
          weight: 0.5,
          metric: 'poi_count',
          direction: 'maximize',
        });
        confidence.byField.poi = 0.6;
      }
    }

    if (hard.filter(c => c.type === 'distance').length === 0) {
      const preferKm = context?.preferredDistanceUnit === 'km';
      hard.push({
        type: 'distance',
        value: preferKm ? 8 : 5,
        unit: preferKm ? 'km' : 'miles',
        source: 'default',
      });
      confidence.byField.distance = 0.5;
    }

    if (objectives.length === 0) {
      objectives.push({
        name: 'distance_accuracy',
        weight: 1.0,
        metric: 'distance_deviation',
        direction: 'minimize',
      });
    }

    const fieldValues = Object.values(confidence.byField) as number[];
    confidence.overall = fieldValues.reduce((sum, val) => sum + val, 0) / Math.max(1, fieldValues.length);

    return {
      constraints: { hard, soft },
      objectives,
      interpretations: [],
      confidence,
      ambiguities,
    };
  }
}
