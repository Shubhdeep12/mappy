/**
 * LLM Provider Interface - Defines contract for language model providers.
 * Implementations: OllamaProvider (dev), GeminiProvider (prod)
 */

export interface LLMProvider {
  /**
   * Generate text completion from prompt
   */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  /**
   * Generate structured JSON output with optional schema validation
   */
  generateJSON<T>(prompt: string, schema?: JSONSchema, options?: GenerateOptions): Promise<T>;

  /**
   * Check if provider is available and healthy
   */
  healthCheck(): Promise<boolean>;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  topP?: number;
  topK?: number;
  /** Role/context for the model, prioritized in Gemini 3 */
  systemInstruction?: string;
  /** Enable native chain-of-thought reasoning */
  thinking?: boolean;
  /** Enable real-time search-augmented generation */
  grounding?: boolean;
}

export interface JSONSchema {
  type: string;
  properties: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
}
