/**
 * Ollama LLM Provider - Local development provider using Ollama server (gemma3:1b).
 * See ENVIRONMENT_STRATEGY.md for setup.
 */


import type { LLMProvider, GenerateOptions, JSONSchema } from './interface.js';

export class OllamaProvider implements LLMProvider {
  private endpoint: string;
  private model: string;
  private timeout: number = 30000; // 30 seconds

  constructor(endpoint: string = 'http://localhost:11434', model: string = 'gemma3:1b') {
    this.endpoint = endpoint.replace(/\/$/, ''); // Remove trailing slash
    this.model = model;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    console.log('Generating with prompt:', prompt);
    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.7,
            num_predict: options?.maxTokens ?? 1000,
            stop: options?.stopSequences,
            top_p: options?.topP,
            top_k: options?.topK,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as { response?: string; error?: string };

      if (!data.response) {
        throw new Error(`Ollama API returned invalid response format: ${data.error || 'Unknown error'}`);
      }

      return data.response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Ollama request timeout after ${this.timeout}ms`);
        }
        throw error;
      }

      throw new Error(`Unknown error in Ollama provider: ${error}`);
    }
  }

  async generateJSON<T>(prompt: string, schema?: JSONSchema): Promise<T> {
    // Don't paste full schema into prompt — small models (e.g. gemma3:1b) often echo it and produce invalid JSON
    const schemaHint = schema
      ? '\nReturn ONLY valid JSON matching the required structure. Do NOT output the schema itself.'
      : '';

    const enhancedPrompt = `${prompt}

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no explanations, no text before or after.${schemaHint}

JSON:`;

    const response = await this.generate(enhancedPrompt, {
      temperature: 0.3, // Lower temperature for more structured output
      maxTokens: 2000,
    });

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonText = response.trim();

    // Remove markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Find JSON object/array
    const jsonMatch = jsonText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!jsonMatch) {
      throw new Error(`No valid JSON found in Ollama response: ${response.substring(0, 200)}`);
    }

    let cleanedJson = jsonMatch[0];

    // Repair common malformed JSON issues from smaller LLMs
    cleanedJson = this.repairJson(cleanedJson);

    try {
      return JSON.parse(cleanedJson) as T;
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON from Ollama response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}\n` +
        `Response preview: ${cleanedJson.substring(0, 200)}`
      );
    }
  }

  /**
   * Repair common JSON malformations from smaller LLMs
   */
  private repairJson(json: string): string {
    let repaired = json;

    // Remove stray quote marks before objects in arrays: ,"{ -> ,{
    repaired = repaired.replace(/,\s*"\s*\{/g, ',{');

    // Remove stray quote marks at start of array: [" { -> [{
    repaired = repaired.replace(/\[\s*"\s*\{/g, '[{');

    // Remove newlines within array (but keep object structure)
    // Replace newlines between array elements with proper comma separation
    repaired = repaired.replace(/\}\s*\n+\s*"\{/g, '},{');
    repaired = repaired.replace(/\}\s*\n+\s*\{/g, '},{');

    // Fix missing commas between array elements
    repaired = repaired.replace(/\}\s+\{/g, '},{');

    // Clean up excessive whitespace/newlines while preserving structure
    repaired = repaired.replace(/\n+/g, ' ');
    repaired = repaired.replace(/\s+/g, ' ');

    // Fix trailing commas before closing brackets
    repaired = repaired.replace(/,\s*\]/g, ']');
    repaired = repaired.replace(/,\s*\}/g, '}');

    return repaired.trim();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for health check

      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}
