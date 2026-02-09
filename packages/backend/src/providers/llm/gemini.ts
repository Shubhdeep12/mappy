import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, GenerateOptions, JSONSchema } from './interface.js';

export class GeminiProvider implements LLMProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeout: number = 60000; // 60 seconds (waypoint optimization can take longer)

  constructor(apiKey: string, model: string = 'gemini-3-flash-preview') {
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
        config.tools = [{ googleSearch: {} }];
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
    let trimmed = '';

    try {
      // Build system instruction that STRONGLY emphasizes JSON-only output
      const jsonOnlyInstruction = options?.systemInstruction
        ? `${options.systemInstruction}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no code blocks, no explanations.`
        : 'Return ONLY valid JSON. No markdown code blocks, no explanations, just the raw JSON object.';

      const generationConfig: any = {
        abortSignal: controller.signal,
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 2048,
        responseMimeType: 'application/json',
        systemInstruction: jsonOnlyInstruction,
      };

      if (schema && this.isSchemaValidForGemini(schema)) {
        generationConfig.responseSchema = schema as unknown;
      }

      // Enable Grounding/Thinking in JSON mode as well if requested
      if (options?.grounding) {
        generationConfig.tools = [{ googleSearch: {} }];
      }
      if (options?.thinking) {
        generationConfig.thinkingConfig = { includeThoughts: true };
      }

      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: generationConfig,
      });

      clearTimeout(timeoutId);

      // Log if response was truncated (helps debug MAX_TOKENS / total token limit issues)
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && String(finishReason) === 'MAX_TOKENS') {
        console.warn('[Gemini] Response truncated (MAX_TOKENS). Consider increasing maxTokens or reducing prompt/response size.');
      }

      const jsonText = response.text;
      if (jsonText == null || jsonText === '') {
        throw new Error('Gemini API returned empty response');
      }

      trimmed = jsonText.trim();

      // PRODUCTION FIX: Extract JSON from markdown-wrapped responses
      // Gemini sometimes ignores responseMimeType and adds "Here is the JSON:\n```json\n..."
      trimmed = this.extractJSON(trimmed);

      try {
        const parsed = JSON.parse(trimmed) as T;

        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0) {
          throw new Error('Gemini returned empty object {}');
        }

        return parsed;
      } catch (parseError) {
        console.warn('[Gemini] JSON parse failed. Raw response:', trimmed.slice(0, 500));
        throw parseError;
      }
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse Gemini JSON output: ${error.message}. Raw output partial: ${trimmed?.slice(0, 1000)}`);
      }
      this.throwWithContext(error, 'generateJSON');
    }
  }

  /**
   * Extract clean JSON from Gemini response text.
   * Handles markdown code blocks and explanatory prefixes.
   * 
   * Production-ready: covers all common Gemini response formats.
   */
  private extractJSON(text: string): string {
    let cleaned = text.trim();

    // Pattern 1: Already clean JSON
    if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
      return cleaned;
    }

    // Pattern 2: Markdown code block: ```json\n{...}\n``` or ```\n{...}\n```
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      return codeBlockMatch[1].trim();
    }

    // Pattern 3: Prefix text like "Here is the JSON requested:" followed by JSON
    const jsonStartMatch = cleaned.match(/([{\[][\s\S]*)/);
    if (jsonStartMatch && jsonStartMatch[1]) {
      return jsonStartMatch[1].trim();
    }

    // Return as-is and let JSON.parse fail with clear error
    return cleaned;
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Gemini] healthCheck failed:', msg, '(model:', this.model + ')');
      return false;
    }
  }
}
