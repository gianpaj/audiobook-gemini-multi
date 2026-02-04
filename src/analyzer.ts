/**
 * Story analyzer module
 *
 * Uses LLM to analyze plain text/prose and identify characters,
 * including narrator, and their likely genders.
 *
 * Supports multiple providers via Vercel AI SDK Provider Registry:
 * - gemini: Google Gemini (default)
 * - grok: xAI Grok
 */

import {
  createGoogleGenerativeAI,
  GoogleGenerativeAIProviderOptions,
} from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { APICallError, createProviderRegistry, generateText } from "ai";

// ============================================================================
// Types
// ============================================================================

export type Gender = "female" | "male" | "neutral";

export type AnalysisProvider = "gemini" | "grok";

export interface Character {
  /** Character name in uppercase (as used in speaker tags) */
  name: string;
  /** Detected gender */
  gender: Gender;
  /** Brief description of the character if detectable */
  description?: string;
  /** Confidence level in the detection */
  confidence: "high" | "medium" | "low";
}

export interface AnalysisOptions {
  /** Model to use in format "provider:model" (e.g., "gemini:gemini-3-pro-preview" or "grok:grok-4-1-fast-reasoning") */
  model?: string;
  /** Whether to include narrator in the analysis */
  includeNarrator?: boolean;
}

export interface AnalysisResult {
  /** Whether analysis was successful */
  success: boolean;
  /** Detected characters */
  characters?: Character[];
  /** Error message if analysis failed */
  error?: string;
  /** Token usage information */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Model used for analysis (in provider:model format) */
  model?: string;
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Default models for each provider
 */
const DEFAULT_MODELS: Record<AnalysisProvider, string> = {
  gemini: "gemini-3-pro-preview",
  grok: "grok-4-1-fast-reasoning",
};

/**
 * Environment variable names for API keys
 */
const API_KEY_ENV_VARS: Record<AnalysisProvider, string> = {
  gemini: "GEMINI_API_KEY",
  grok: "XAI_API_KEY",
};

/**
 * Create the provider registry with configured providers
 * API keys are read from environment variables
 */
function createAnalyzerRegistry() {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const xaiApiKey = process.env.XAI_API_KEY;

  const providers: Record<
    string,
    ReturnType<typeof createGoogleGenerativeAI | typeof createXai>
  > = {};

  // Only register providers that have API keys configured
  if (geminiApiKey) {
    providers.gemini = createGoogleGenerativeAI({ apiKey: geminiApiKey });
  }

  if (xaiApiKey) {
    providers.grok = createXai({ apiKey: xaiApiKey });
  }

  return createProviderRegistry(providers);
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are a text analyzer that identifies characters in stories and determines their likely gender.

Your task is to:
1. Identify all characters who speak or are referenced in the text
2. Determine each character's gender based on context clues (names, pronouns, descriptions)
3. Include a NARRATOR entry if the text has narration/description that would need a voice

Gender classification:
- "female": Characters identified as women/girls through pronouns (she/her), names, or explicit description
- "male": Characters identified as men/boys through pronouns (he/him), names, or explicit description
- "neutral": Characters with ambiguous gender, non-binary characters, narrators (unless clearly gendered), or when unsure

Rules:
- Character names should be in UPPERCASE
- Always include confidence level: "high" (explicit pronouns/descriptions), "medium" (name-based inference), "low" (uncertain)
- For NARRATOR, use "neutral" unless the text clearly indicates a gendered narrator
- Do not invent characters that aren't in the text
- Include brief descriptions when context is available

Respond ONLY with valid JSON in this exact format:
{
  "characters": [
    {
      "name": "CHARACTER_NAME",
      "gender": "female|male|neutral",
      "description": "brief description if available",
      "confidence": "high|medium|low"
    }
  ]
}`;

function createAnalysisPrompt(text: string, options: AnalysisOptions): string {
  let prompt = `Analyze the following text and identify all characters who speak or are referenced.

`;

  if (options.includeNarrator !== false) {
    prompt += `Include a NARRATOR entry if there is any narration, description, or non-dialogue text that would need to be voiced in an audiobook.

`;
  } else {
    prompt += `Do NOT include a NARRATOR entry - only identify speaking characters.

`;
  }

  prompt += `Text to analyze:
---
${text}
---

Respond with JSON only:`;

  return prompt;
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Parse a model string into provider and model parts
 * Supports formats: "provider:model" or just "model" (uses default provider)
 */
function parseModelString(modelString: string): {
  provider: AnalysisProvider;
  model: string;
} {
  if (modelString.includes(":")) {
    const [provider, model] = modelString.split(":", 2);
    if (!getSupportedProviders().includes(provider as AnalysisProvider)) {
      throw new Error(
        `Unknown provider: ${provider}. Supported: ${getSupportedProviders().join(", ")}`,
      );
    }
    return { provider: provider as AnalysisProvider, model };
  }

  // No provider specified, try to infer from model name
  if (modelString.startsWith("grok")) {
    return { provider: "grok", model: modelString };
  }
  if (modelString.startsWith("gemini")) {
    return { provider: "gemini", model: modelString };
  }

  // Default to grok
  return { provider: "grok", model: modelString };
}

/**
 * Get the full model ID for the registry (provider:model format)
 */
function getFullModelId(options: AnalysisOptions): string {
  if (options.model) {
    const { provider, model } = parseModelString(options.model);
    return `${provider}:${model}`;
  }
  // Default to grok with default model
  return `grok:${DEFAULT_MODELS.grok}`;
}

/**
 * Analyze text to identify characters and their genders
 * Uses the provider registry for unified model access
 */
export async function analyzeStory(
  text: string,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const fullModelId = getFullModelId(options);
  const { provider } = parseModelString(fullModelId);

  // Check if API key is available
  const apiKeyEnvVar = API_KEY_ENV_VARS[provider];
  if (!process.env[apiKeyEnvVar]) {
    return {
      success: false,
      error: `API key is required. Set ${apiKeyEnvVar} environment variable.`,
    };
  }

  try {
    const registry = createAnalyzerRegistry();
    const prompt = createAnalysisPrompt(text, options);

    const result = await generateText({
      model: registry.languageModel(fullModelId as `${string}:${string}`),
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0.2, // Low temperature for consistent analysis
      providerOptions: {
        // Only `grok-3-mini` supports `reasoning_effort`
        // xai: {
        //   reasoningEffort: "high",
        // } satisfies XaiProviderOptions,
        google: {
          thinkingConfig: {
            thinkingLevel: "high",
            includeThoughts: true,
          },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
    });

    const content = result.text?.trim();

    if (!content) {
      return {
        success: false,
        error: "No content received from LLM",
      };
    }

    // Parse JSON response
    const parsed = parseAnalysisResponse(content);

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error,
      };
    }

    return {
      success: true,
      characters: parsed.characters,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
      },
      model: fullModelId,
    };
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : String(error);
    // console.error(error);
    if (error instanceof APICallError) {
      errorMessage = error.responseBody
        ? JSON.parse(error.responseBody).error
        : errorMessage;
    }
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Parse the JSON response from the LLM
 */
function parseAnalysisResponse(content: string): {
  success: boolean;
  characters?: Character[];
  error?: string;
} {
  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = content;

    // Remove markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);

    if (!data.characters || !Array.isArray(data.characters)) {
      return {
        success: false,
        error: "Invalid response format: missing characters array",
      };
    }

    // Validate and normalize each character
    const characters: Character[] = [];
    for (const char of data.characters) {
      if (!char.name || typeof char.name !== "string") {
        continue; // Skip invalid entries
      }

      const normalized: Character = {
        name: char.name.toUpperCase().replace(/\s+/g, "_"),
        gender: normalizeGender(char.gender),
        confidence: normalizeConfidence(char.confidence),
      };

      if (char.description && typeof char.description === "string") {
        normalized.description = char.description;
      }

      characters.push(normalized);
    }

    return {
      success: true,
      characters,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse LLM response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Normalize gender value
 */
function normalizeGender(value: unknown): Gender {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (
      lower === "female" ||
      lower === "f" ||
      lower === "woman" ||
      lower === "girl"
    ) {
      return "female";
    }
    if (
      lower === "male" ||
      lower === "m" ||
      lower === "man" ||
      lower === "boy"
    ) {
      return "male";
    }
  }
  return "neutral";
}

/**
 * Normalize confidence value
 */
function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "high" || lower === "h") {
      return "high";
    }
    if (lower === "low" || lower === "l") {
      return "low";
    }
  }
  return "medium";
}

// ============================================================================
// Display & Utility Functions
// ============================================================================

/**
 * Format analysis result for display
 */
export function formatAnalysisResult(result: AnalysisResult): string {
  if (!result.success || !result.characters) {
    return `Analysis failed: ${result.error || "Unknown error"}`;
  }

  const lines: string[] = [];

  // Group by gender
  const female = result.characters.filter((c) => c.gender === "female");
  const male = result.characters.filter((c) => c.gender === "male");
  const neutral = result.characters.filter((c) => c.gender === "neutral");

  const formatChar = (char: Character): string => {
    let line = `  ${char.name}`;
    if (char.description) {
      line += ` - ${char.description}`;
    }
    line += ` (${char.confidence} confidence)`;
    return line;
  };

  if (female.length > 0) {
    lines.push("Female:");
    for (const char of female) {
      lines.push(formatChar(char));
    }
    lines.push("");
  }

  if (male.length > 0) {
    lines.push("Male:");
    for (const char of male) {
      lines.push(formatChar(char));
    }
    lines.push("");
  }

  if (neutral.length > 0) {
    lines.push("Neutral/Unknown:");
    for (const char of neutral) {
      lines.push(formatChar(char));
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get speaker list formatted for -s option
 */
export function getSpeakerListForConvert(result: AnalysisResult): string {
  if (!result.success || !result.characters) {
    return "";
  }

  return result.characters.map((c) => c.name).join(",");
}

/**
 * Get analysis prompt for manual use or debugging
 */
export function getAnalysisPrompt(
  text: string,
  options: AnalysisOptions = {},
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: createAnalysisPrompt(text, options),
  };
}

/**
 * Get list of supported providers
 */
export function getSupportedProviders(): AnalysisProvider[] {
  return ["gemini", "grok"];
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: AnalysisProvider): string {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.grok;
}

/**
 * Get the environment variable name for a provider's API key
 */
export function getApiKeyEnvVar(provider: AnalysisProvider): string {
  return API_KEY_ENV_VARS[provider] || API_KEY_ENV_VARS.gemini;
}

/**
 * Get the default model ID in registry format (provider:model)
 */
export function getDefaultModelId(provider: AnalysisProvider = "grok"): string {
  return `${provider}:${DEFAULT_MODELS[provider]}`;
}
