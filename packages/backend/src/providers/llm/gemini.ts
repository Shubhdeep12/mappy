/**
 * Gemini LLM Provider (Production)
 *
 * Uses the official @google/genai SDK for Google Gemini API.
 * Recommended for production: maintained by Google, type-safe, and gets
 * new Gemini 2.0+ features (JSON mode, schema, streaming, etc.).
 *
 * Features:
 * - Gemini 2.0 Flash model (fast, cost-effective)
 * - Native JSON mode (responseMimeType: 'application/json')
 * - Structured output with optional responseSchema
 * - Timeout and error handling via SDK + AbortSignal
 * - Health check via models.get()
 *
 * @see https://www.npmjs.com/package/@google/genai
 * @see https://googleapis.github.io/js-genai/
 */

import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, GenerateOptions, JSONSchema } from './interface';

export class GeminiProvider implements LLMProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeout: number = 30000; // 30 seconds

  constructor(apiKey: string, model: string = 'gemini-3.0-flash') {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const config: any = {
        abortSignal: controller.signal,
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 2048,
        stopSequences: options?.stopSequences,
        topP: options?.topP,
        topK: options?.topK,
        systemInstruction: options?.systemInstruction,
      };

      // Enable Grounding if requested
      if (options?.grounding) {
        config.tools = [{ googleSearchRetrieval: {} }];
      }

      // Enable Thinking if requested
      if (options?.thinking) {
        config.thinkingConfig = { includeThoughts: true };
      }

      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config,
      });

      clearTimeout(timeoutId);

      // Log thoughts for debugging if they exist
      if (response.candidates?.[0]?.content?.parts?.find((p: any) => p.thought)) {
        const thought = response.candidates[0].content.parts.find((p: any) => p.thought).text;
        console.log(`[Gemini Thinking]: ${thought}`);
      }

      const text = response.text;
      if (text == null || text === '') {
        throw new Error('Gemini API returned empty response');
      }
      return text;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      this.throwWithContext(error, 'generate');
    }
  }

  async generateJSON<T>(prompt: string, schema?: JSONSchema, options?: GenerateOptions): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const config: any = {
        abortSignal: controller.signal,
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 2048,
        responseMimeType: 'application/json',
        systemInstruction: options?.systemInstruction,
      };

      if (schema && this.isSchemaValidForGemini(schema)) {
        config.responseSchema = schema as unknown;
      }

      // Enable Grounding/Thinking in JSON mode as well if requested
      if (options?.grounding) {
        config.tools = [{ googleSearchRetrieval: {} }];
      }
      if (options?.thinking) {
        config.thinkingConfig = { includeThoughts: true };
      }

      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config,
      });

      clearTimeout(timeoutId);

      const jsonText = response.text;
      if (jsonText == null || jsonText === '') {
        throw new Error('Gemini API returned empty response');
      }

      // Gemini 3 JSON mode is pure and doesn't require markdown cleaning
      // but we trim just in case of trailing whitespace
      return JSON.parse(jsonText.trim()) as T;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse Gemini JSON output: ${error.message}. Raw output: ${JSON.stringify(error)}`);
      }
      this.throwWithContext(error, 'generateJSON');
    }
  }

  private isSchemaValidForGemini(schema: unknown): boolean {
    try {
      const checkObject = (obj: unknown): boolean => {
        if (obj !== null && typeof obj === 'object' && 'type' in obj) {
          const o = obj as { type?: string; properties?: Record<string, unknown>; items?: unknown };
          if (o.type === 'object') {
            if (!o.properties || Object.keys(o.properties).length === 0) {
              return false;
            }
            for (const prop of Object.values(o.properties)) {
              if (!checkObject(prop)) return false;
            }
          } else if (o.type === 'array' && o.items) {
            return checkObject(o.items);
          }
        }
        return true;
      };
      return checkObject(schema);
    } catch {
      return false;
    }
  }

  private throwWithContext(error: unknown, method: string): never {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Gemini request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
    throw new Error(`Unknown error in Gemini provider (${method}): ${String(error)}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const timeoutMs = 5000;
      await Promise.race([
        this.client.models.get({ model: this.model }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeoutMs)
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
