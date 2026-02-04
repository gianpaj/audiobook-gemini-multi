/**
 * Story analyzer module
 *
 * Uses LLM to analyze plain text/prose and identify characters,
 * including narrator, and their likely genders.
 *
 * Supports multiple providers via Vercel AI SDK: Gemini (default) and Grok (xAI)
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";

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
  /** LLM provider to use (default: "gemini") */
  provider?: AnalysisProvider;
  /** API key for LLM provider */
  apiKey?: string;
  /** Model to use for analysis */
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
  /** Provider used for analysis */
  provider?: AnalysisProvider;
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
 * Analyze text to identify characters and their genders using Gemini via AI SDK
 */
export async function analyzeWithGemini(
  text: string,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error:
        "API key is required. Set GEMINI_API_KEY environment variable or pass apiKey option.",
    };
  }

  const model = options.model || "gemini-2.5-flash";

  try {
    const prompt = createAnalysisPrompt(text, options);

    // Create Google provider with API key
    const google = createGoogleGenerativeAI({ apiKey });

    const result = await generateText({
      model: google(model),
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0.2, // Low temperature for consistent analysis
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
      provider: "gemini",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Analysis failed: ${errorMessage}`,
    };
  }
}

/**
 * Analyze text to identify characters and their genders using Grok (xAI) via AI SDK
 */
export async function analyzeWithGrok(
  text: string,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const apiKey = options.apiKey || process.env.XAI_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error:
        "API key is required. Set XAI_API_KEY environment variable or pass apiKey option.",
    };
  }

  const model = options.model || "grok-3-fast";

  try {
    const prompt = createAnalysisPrompt(text, options);

    // Create xAI provider with API key
    const xai = createXai({ apiKey });

    const result = await generateText({
      model: xai(model),
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0.2, // Low temperature for consistent analysis
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
      provider: "grok",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Analysis failed: ${errorMessage}`,
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

/**
 * Analyze text for characters - main entry point
 * Supports multiple providers via the provider option
 */
export async function analyzeStory(
  text: string,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const provider = options.provider || "gemini";

  switch (provider) {
    case "grok":
      return analyzeWithGrok(text, options);
    case "gemini":
    default:
      return analyzeWithGemini(text, options);
  }
}

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
  switch (provider) {
    case "grok":
      return "grok-3-fast";
    case "gemini":
    default:
      return "gemini-2.5-flash";
  }
}

/**
 * Get the environment variable name for a provider's API key
 */
export function getApiKeyEnvVar(provider: AnalysisProvider): string {
  switch (provider) {
    case "grok":
      return "XAI_API_KEY";
    case "gemini":
    default:
      return "GEMINI_API_KEY";
  }
}
