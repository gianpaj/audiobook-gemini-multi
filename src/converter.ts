/**
 * Story format converter module
 *
 * Uses LLM to convert plain text/prose into speaker-tagged story format
 * suitable for audiobook generation.
 */

import { GoogleGenAI } from "@google/genai";

// ============================================================================
// Types
// ============================================================================

export interface ConversionOptions {
  /** API key for LLM provider */
  apiKey?: string;
  /** Model to use for conversion */
  model?: string;
  /** Custom speakers to use (optional, LLM will auto-detect if not provided) */
  speakers?: string[];
  /** Whether to include a NARRATOR for non-dialogue text */
  includeNarrator?: boolean;
  /** Output format: 'bracket' for [SPEAKER] or 'colon' for SPEAKER: */
  format?: "bracket" | "colon";
  /** Maximum tokens for input (will chunk if exceeded) */
  maxInputTokens?: number;
}

export interface ConversionResult {
  /** Whether conversion was successful */
  success: boolean;
  /** Converted story content */
  content?: string;
  /** Detected or used speakers */
  speakers?: string[];
  /** Error message if conversion failed */
  error?: string;
  /** Token usage information */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are a script formatter that converts prose, stories, or plain text into a speaker-tagged format for audiobook generation.

Your task is to:
1. Identify all characters/speakers in the text
2. Assign dialogue to the appropriate speakers
3. Mark narration/description with a NARRATOR tag
4. Output the text in a clean, consistent speaker-tagged format

Rules:
- Every line of output must start with a speaker tag
- Use NARRATOR for all non-dialogue text (descriptions, actions, scene-setting)
- Use character names in UPPERCASE for speaker tags (e.g., ALICE, BOB, NARRATOR)
- Keep the original dialogue text intact - do not modify or summarize it
- Maintain the original order and flow of the story
- Each segment should be a natural speech unit (typically 1-3 sentences)
- Do not include any comments, explanations, or metadata in the output
- Do not include empty lines between segments
- If a character's name is mentioned in the prose, use that exact name (uppercased) as the speaker tag`;

function createConversionPrompt(
  text: string,
  options: ConversionOptions,
): string {
  const formatExample =
    options.format === "colon"
      ? `NARRATOR: Once upon a time, there was a young girl named Alice.
ALICE: Hello! Is anyone there?
NARRATOR: She called out into the darkness.
BOB: I'm here! Don't worry.
NARRATOR: A friendly voice answered back.`
      : `[NARRATOR] Once upon a time, there was a young girl named Alice.
[ALICE] Hello! Is anyone there?
[NARRATOR] She called out into the darkness.
[BOB] I'm here! Don't worry.
[NARRATOR] A friendly voice answered back.`;

  let prompt = `Convert the following text into speaker-tagged format for audiobook generation.

Output Format: ${options.format === "colon" ? "SPEAKER: dialogue" : "[SPEAKER] dialogue"}

Example output:
${formatExample}

`;

  if (options.speakers && options.speakers.length > 0) {
    prompt += `Use these specific speaker names: ${options.speakers.join(", ")}\n\n`;
  }

  if (options.includeNarrator === false) {
    prompt += `Note: Do not include a NARRATOR. Only include direct dialogue from characters.\n\n`;
  }

  prompt += `Text to convert:
---
${text}
---

Output the converted text only, with no additional commentary:`;

  return prompt;
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert plain text to speaker-tagged format using Gemini
 */
export async function convertWithGemini(
  text: string,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error:
        "API key is required. Set GEMINI_API_KEY environment variable or pass apiKey option.",
    };
  }

  const model = options.model || "gemini-3-pro-preview";
  // const model = options.model || "gemini-3-flash-preview";
  const format = options.format || "bracket";

  try {
    const client = new GoogleGenAI({ apiKey });

    const prompt = createConversionPrompt(text, { ...options, format });

    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      config: {
        temperature: 0.3, // Lower temperature for more consistent formatting
        systemInstruction: SYSTEM_PROMPT,
      },
    });

    const content = response.text?.trim();

    if (!content) {
      return {
        success: false,
        error: "No content received from LLM",
      };
    }

    // Extract speakers from the converted content
    const speakers = extractSpeakers(content, format);

    return {
      success: true,
      content,
      speakers,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Conversion failed: ${errorMessage}`,
    };
  }
}

/**
 * Extract unique speakers from converted content
 */
export function extractSpeakers(
  content: string,
  format: "bracket" | "colon" = "bracket",
): string[] {
  const speakers = new Set<string>();

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let speaker: string | null = null;

    if (format === "bracket") {
      const match = trimmed.match(/^\[([A-Z][A-Z0-9_]*)\]/);
      if (match) {
        speaker = match[1];
      }
    } else {
      const match = trimmed.match(/^([A-Z][A-Z0-9_]*):/);
      if (match) {
        speaker = match[1];
      }
    }

    if (speaker) {
      speakers.add(speaker);
    }
  }

  return Array.from(speakers).sort();
}

/**
 * Validate converted content format
 */
export function validateConvertedContent(
  content: string,
  format: "bracket" | "colon" = "bracket",
): { valid: boolean; errors: string[]; lineCount: number } {
  const errors: string[] = [];
  const lines = content.split("\n");
  let validLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const lineNum = i + 1;
    let isValid = false;

    if (format === "bracket") {
      isValid = /^\[[A-Z][A-Z0-9_]*\]\s+.+/.test(line);
      if (!isValid && line.length > 0) {
        errors.push(
          `Line ${lineNum}: Invalid format. Expected [SPEAKER] text, got: "${line.substring(0, 50)}..."`,
        );
      }
    } else {
      isValid = /^[A-Z][A-Z0-9_]*:\s+.+/.test(line);
      if (!isValid && line.length > 0) {
        errors.push(
          `Line ${lineNum}: Invalid format. Expected SPEAKER: text, got: "${line.substring(0, 50)}..."`,
        );
      }
    }

    if (isValid) {
      validLineCount++;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    lineCount: validLineCount,
  };
}

/**
 * Post-process converted content to fix common issues
 */
export function postProcessContent(
  content: string,
  format: "bracket" | "colon" = "bracket",
): string {
  let lines = content.split("\n");

  // Remove empty lines
  lines = lines.filter((line) => line.trim().length > 0);

  // Fix common formatting issues
  lines = lines.map((line) => {
    let trimmed = line.trim();

    // Fix missing space after speaker tag
    if (format === "bracket") {
      trimmed = trimmed.replace(/^\[([A-Z][A-Z0-9_]*)\]([^\s])/, "[$1] $2");
    } else {
      trimmed = trimmed.replace(/^([A-Z][A-Z0-9_]*):([^\s])/, "$1: $2");
    }

    // Normalize multiple spaces
    trimmed = trimmed.replace(/\s+/g, " ");

    return trimmed;
  });

  return lines.join("\n");
}

/**
 * Estimate token count for text (rough approximation)
 */
export function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks for processing large documents
 */
export function splitIntoChunks(
  text: string,
  maxTokens: number = 8000,
): string[] {
  const estimatedTokens = estimateTokenCount(text);

  if (estimatedTokens <= maxTokens) {
    return [text];
  }

  // Split by paragraphs (double newline)
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const newChunk = currentChunk
      ? currentChunk + "\n\n" + paragraph
      : paragraph;
    const newTokens = estimateTokenCount(newChunk);

    if (newTokens > maxTokens && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = paragraph;
    } else {
      currentChunk = newChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Convert a large document by processing in chunks
 */
export async function convertLargeDocument(
  text: string,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  const maxTokens = options.maxInputTokens || 8000;
  const chunks = splitIntoChunks(text, maxTokens);

  if (chunks.length === 1) {
    return convertWithGemini(text, options);
  }

  const results: string[] = [];
  const allSpeakers = new Set<string>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // For subsequent chunks, pass the speakers we've seen so far
    const chunkOptions: ConversionOptions = {
      ...options,
      speakers:
        i > 0 && allSpeakers.size > 0
          ? Array.from(allSpeakers)
          : options.speakers,
    };

    const result = await convertWithGemini(chunk, chunkOptions);

    if (!result.success) {
      return {
        success: false,
        error: `Failed to convert chunk ${i + 1}/${chunks.length}: ${result.error}`,
      };
    }

    results.push(result.content!);

    if (result.speakers) {
      for (const speaker of result.speakers) {
        allSpeakers.add(speaker);
      }
    }

    if (result.usage) {
      totalInputTokens += result.usage.inputTokens;
      totalOutputTokens += result.usage.outputTokens;
    }
  }

  const content = results.join("\n");

  return {
    success: true,
    content: postProcessContent(content, options.format || "bracket"),
    speakers: Array.from(allSpeakers).sort(),
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Convert text with automatic chunking and post-processing
 */
export async function convertToStoryFormat(
  text: string,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  const result = await convertLargeDocument(text, options);

  if (!result.success || !result.content) {
    return result;
  }

  // Post-process the content
  const processedContent = postProcessContent(
    result.content,
    options.format || "bracket",
  );

  // Validate the result
  const validation = validateConvertedContent(
    processedContent,
    options.format || "bracket",
  );

  if (!validation.valid) {
    console.warn(
      "Warning: Converted content has formatting issues:",
      validation.errors.slice(0, 5),
    );
  }

  return {
    ...result,
    content: processedContent,
  };
}

/**
 * Get the conversion prompt for manual use or debugging
 */
export function getConversionPrompt(
  text: string,
  options: ConversionOptions = {},
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: createConversionPrompt(text, {
      ...options,
      format: options.format || "bracket",
    }),
  };
}
