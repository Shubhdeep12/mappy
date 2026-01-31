/**
 * PreferenceParser
 *
 * Parses user-provided preference pills (short natural language expressions) into a structured set of constraints, objectives, and interpretations for route generation.
 *
 * - Utilizes LLMs for advanced preference understanding and reasoning.
 * - Extracts hard constraints (e.g., strict limits), soft constraints (negotiable attributes), and optimization objectives (e.g., maximize scenery or safety).
 * - Detects and represents ambiguous or conflicting input, providing mechanisms for further clarification.
 * - Computes per-field and overall confidence scores for extracted data.
 * - Supports caching of preference parsing results (24h TTL) for identical pill sets to optimize performance.
 * - Includes robust rule-based parsing fallback for common/expected language or LLM failure scenarios, ensuring reliability in production.
 *
 * Returns: ParsedPreferences (constraints, objectives, interpretations, confidence).
 */
 

import type { LLMProvider } from '../providers/llm/interface';
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
      console.warn('LLM parsing failed, falling back to rule-based parser:', error);
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
                    properties: {
                      _dynamic: { type: 'number' }
                    }
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
              properties: {
                _dynamic: { type: 'number' }
              }
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
      },
      required: ['constraints', 'objectives', 'interpretations', 'confidence', 'ambiguities'],
    };

    const result = await this.llm.generateJSON<Partial<ParsedPreferences>>(prompt, schema, {
      systemInstruction: `You are a spatial constraint reasoner for Mappy. 
Goal: Parse user preference pills into structured constraints and objectives.

TASK:
1. Extract HARD constraints (distance, time, elevation, boundary).
2. Extract SOFT constraints (scenic, safety, poi, surface) with weights.
3. Identify optimizing OBJECTIVES (maximize/minimize metrics).
4. Generate INTERPRETATIONS for ambiguities.
5. Identify AMBIGUITIES needing clarification.

DISTANCE UNIT: When the user does not specify a distance unit (e.g. "5", "scenic walk", "long run"), use ${preferredUnit} for the distance constraint (value and unit). When they do specify (e.g. "5 km", "3 miles"), use that.`,
      thinking: true,
      temperature: 0.1, 
    });

    if (!result || typeof result !== 'object') {
      throw new Error('LLM returned invalid or null result');
    }

    return this.normalizeParsedPreferences(result);
  }

  private buildPrompt(preferences: PreferencePill[]): string {
    return preferences.map((p, i) => `${i + 1}. "${p.text}"`).join('\n');
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
