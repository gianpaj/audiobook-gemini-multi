/**
 * TTS Provider Interface and Implementations
 *
 * Provides an abstract interface for TTS providers and a concrete
 * implementation for Google's Gemini TTS API
 */

import {
  GoogleGenAI,
  FinishReason,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import { writeFile, stat } from "fs/promises";
import { dirname } from "path";
import { mkdir } from "fs/promises";
import type {
  TTSRequest,
  TTSResponse,
  MultiSpeakerTTSRequest,
  ProviderConfig,
  Segment,
  Config,
} from "./types.js";
import { getVoiceConfig, resolveEnvVars } from "./config.js";
import { debugLog } from "./utils.js";

// ============================================================================
// Abstract TTS Provider Interface
// ============================================================================

/**
 * Abstract interface for TTS providers
 */
export interface TTSProvider {
  /** Provider name */
  readonly name: string;

  /** Initialize the provider */
  initialize(): Promise<void>;

  /** Generate audio for a single segment */
  generateAudio(request: TTSRequest): Promise<TTSResponse>;

  /** Generate audio for multiple segments (if supported) */
  generateMultiSpeaker?(request: MultiSpeakerTTSRequest): Promise<TTSResponse>;

  /** Check if the provider is available and configured */
  isAvailable(): Promise<boolean>;

  /** Get estimated cost for text (if available) */
  estimateCost?(text: string): number | null;

  /** Get rate limit info */
  getRateLimitInfo(): { requestsPerMinute: number; currentUsage: number };
}

// ============================================================================
// WAV Conversion Utilities
// ============================================================================

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function parseMimeType(mimeType: string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(";").map((s) => s.trim());
  const [_, format] = fileType.split("/");

  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
  };

  if (format && format.startsWith("L")) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split("=").map((s) => s.trim());
    if (key === "rate") {
      options.sampleRate = parseInt(value, 10);
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(
  dataLength: number,
  options: WavConversionOptions,
): Buffer {
  const { numChannels, sampleRate, bitsPerSample } = options;

  // http://soundfile.sapp.org/doc/WaveFormat
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0); // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  buffer.write("WAVE", 8); // Format
  buffer.write("fmt ", 12); // Subchunk1ID
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  buffer.write("data", 36); // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return buffer;
}

function convertToWav(rawData: string, mimeType: string): Buffer {
  const options = parseMimeType(mimeType);
  const buffer = Buffer.from(rawData, "base64");
  const wavHeader = createWavHeader(buffer.length, options);

  return Buffer.concat([wavHeader, buffer]);
}

/**
 * Estimate audio duration from WAV buffer
 */
function estimateWavDuration(buffer: Buffer): number {
  // Read WAV header to get duration
  if (buffer.length < 44) {
    return 0;
  }

  try {
    const sampleRate = buffer.readUInt32LE(24);
    const numChannels = buffer.readUInt16LE(22);
    const bitsPerSample = buffer.readUInt16LE(34);
    const dataSize = buffer.readUInt32LE(40);

    const bytesPerSample = bitsPerSample / 8;
    const numSamples = dataSize / (numChannels * bytesPerSample);
    const durationMs = (numSamples / sampleRate) * 1000;

    return Math.round(durationMs);
  } catch {
    return 0;
  }
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number = 60000; // 1 minute

  constructor(requestsPerMinute: number) {
    this.maxRequests = requestsPerMinute;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    // Remove old requests outside the window
    this.requests = this.requests.filter((t) => now - t < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      // Wait until the oldest request expires
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest) + 100; // Add 100ms buffer
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.waitForSlot();
    }

    this.requests.push(now);
  }

  getCurrentUsage(): number {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < this.windowMs);
    return this.requests.length;
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      const errorMessage = lastError.message.toLowerCase();
      const isRetryable =
        errorMessage.includes("rate limit") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("503") ||
        errorMessage.includes("429") ||
        errorMessage.includes("500");

      if (!isRetryable || attempt === options.maxRetries) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        options.maxDelayMs,
      );

      console.warn(
        `Request failed (attempt ${attempt + 1}/${options.maxRetries + 1}), retrying in ${Math.round(delay)}ms: ${lastError.message}`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================================
// Gemini TTS Provider
// ============================================================================

/**
 * Google Gemini TTS Provider
 */
export class GeminiTTSProvider implements TTSProvider {
  readonly name = "gemini";

  private client: GoogleGenAI | null = null;
  private config: ProviderConfig;
  private rateLimiter: RateLimiter;
  private globalSeed?: number;

  constructor(config: ProviderConfig, globalSeed?: number) {
    this.config = config;
    this.globalSeed = globalSeed;
    this.rateLimiter = new RateLimiter(config.rateLimit || 60);
  }

  async initialize(): Promise<void> {
    const apiKey = this.config.apiKey
      ? resolveEnvVars(this.config.apiKey)
      : process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Gemini API key not found. Set GEMINI_API_KEY environment variable or configure in config.json",
      );
    }

    this.client = new GoogleGenAI({ apiKey });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }
    return true;
  }

  async generateAudio(request: TTSRequest): Promise<TTSResponse> {
    if (!this.client) {
      await this.initialize();
    }

    // Wait for rate limit slot
    await this.rateLimiter.waitForSlot();

    // Track seed for retry with increment on "OTHER" finish reason
    const baseSeed = request.voice.seed ?? this.globalSeed ?? 0;
    let currentSeed = baseSeed;
    const maxSeedRetries = 3;

    for (let seedAttempt = 0; seedAttempt <= maxSeedRetries; seedAttempt++) {
      try {
        const result = await withRetry(
          async () => {
            const voiceName = request.voice.voiceName || "Zephyr";
            const seed = currentSeed;
            const genConfig: GenerateContentConfig = {
              // temperature: 1,
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceName,
                  },
                },
              },
              safetySettings: [
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
              ],
              seed,
            };

            const model = this.config.model || "gemini-2.5-pro-preview-tts";

            // Build the prompt with style instructions
            let textPrompt = request.text;
            if (request.voice.stylePrompt) {
              textPrompt = `${request.voice.stylePrompt}: ${request.text}`;
            }

            const contents = [
              {
                parts: [{ text: textPrompt }],
              },
            ];

            await debugLog(
              "\n=== DEBUG: Text Prompt ===\n" +
                `genConfig: ${JSON.stringify(genConfig)}\n` +
                `Voice: ${request.voice.voiceName || "Zephyr"}\n` +
                `Seed: ${seed}\n` +
                textPrompt +
                "\n=== END DEBUG ===\n",
            );

            const response = await this.client!.models.generateContent({
              model,
              config: genConfig,
              contents,
            });

            // Check for blocked content or incomplete generation
            const finishReason = response?.candidates?.[0]?.finishReason;
            const blockReason = response?.promptFeedback?.blockReason;

            if (blockReason) {
              const debugInfo = {
                blockReason,
                promptFeedback: response?.promptFeedback,
                candidates: response?.candidates?.map((c) => ({
                  finishReason: c.finishReason,
                  safetyRatings: c.safetyRatings,
                })),
                requestText: textPrompt,
              };
              await debugLog(
                "\n=== DEBUG: Content Blocked ===\n" +
                  JSON.stringify(debugInfo, null, 2) +
                  "\n=== END DEBUG ===\n",
              );

              throw new Error(`Content blocked: ${blockReason}`);
            }

            if (finishReason && finishReason !== FinishReason.STOP) {
              const debugInfo = {
                finishReason,
                promptFeedback: response?.promptFeedback,
                candidates: response?.candidates?.map((c) => ({
                  finishReason: c.finishReason,
                  safetyRatings: c.safetyRatings,
                  content: c.content
                    ? { parts: c.content.parts?.length }
                    : null,
                })),
                requestText: textPrompt,
              };
              await debugLog(
                "\n=== DEBUG: Generation Incomplete ===\n" +
                  JSON.stringify(debugInfo, null, 2) +
                  "\n=== END DEBUG ===\n",
              );

              throw new Error(`Generation incomplete: ${finishReason}`);
            }

            // Extract audio data from response
            const inlineData =
              response.candidates?.[0]?.content?.parts?.[0]?.inlineData;

            if (!inlineData?.data) {
              return null;
            }

            const mimeType = inlineData.mimeType || "audio/L16;rate=24000";

            // Convert to WAV format
            return convertToWav(inlineData.data, mimeType);
          },
          {
            maxRetries: this.config.maxRetries ?? 3,
            baseDelayMs: 1000,
            maxDelayMs: 30000,
          },
        );

        if (!result) {
          return {
            success: false,
            error: "No audio data received from Gemini API",
          };
        }

        // Ensure output directory exists
        await mkdir(dirname(request.outputPath), { recursive: true });

        // Write audio file
        await writeFile(request.outputPath, result);

        // Get file stats
        const fileStats = await stat(request.outputPath);

        // Estimate duration
        const durationMs = estimateWavDuration(result);

        return {
          success: true,
          audioPath: request.outputPath,
          durationMs,
          fileSize: fileStats.size,
          audioData: result,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check if this is a "Generation incomplete: OTHER" error that we can retry with a different seed
        if (
          errorMessage.includes("Generation incomplete: OTHER") &&
          seedAttempt < maxSeedRetries
        ) {
          currentSeed = baseSeed + seedAttempt + 1;
          console.error(
            `\n⚠️  Generation failed with OTHER, retrying with seed ${currentSeed} (attempt ${seedAttempt + 2}/${maxSeedRetries + 1})`,
          );
          await debugLog(
            `\n=== DEBUG: Retrying with incremented seed ===\n` +
              `Original seed: ${baseSeed}\n` +
              `New seed: ${currentSeed}\n` +
              `Attempt: ${seedAttempt + 2}/${maxSeedRetries + 1}\n` +
              `=== END DEBUG ===\n`,
          );
          continue; // Try again with the new seed
        }

        return {
          success: false,
          error: `Gemini TTS generation failed: ${errorMessage}`,
        };
      }
    }

    // Should not reach here, but just in case
    return {
      success: false,
      error: `Gemini TTS generation failed after ${maxSeedRetries + 1} seed attempts`,
    };
  }

  async generateMultiSpeaker(
    request: MultiSpeakerTTSRequest,
  ): Promise<TTSResponse> {
    if (!this.client) {
      await this.initialize();
    }

    // Wait for rate limit slot
    await this.rateLimiter.waitForSlot();

    // Track seed for retry with increment on "OTHER" finish reason
    const baseSeed = request.seed ?? this.globalSeed ?? 0;
    let currentSeed = baseSeed;
    const maxSeedRetries = 3;

    for (let seedAttempt = 0; seedAttempt <= maxSeedRetries; seedAttempt++) {
      try {
        const result = await withRetry(
          async () => {
            // Build speaker voice configs
            const speakerVoiceConfigs = Array.from(
              request.voices.entries(),
            ).map(([speaker, voice]) => ({
              speaker,
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice.voiceName || "Zephyr",
                },
              },
            }));

            const genConfig: GenerateContentConfig = {
              temperature: 1,
              responseModalities: ["audio"],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs,
                },
              },
              seed: currentSeed,
              safetySettings: [
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
              ],
            };

            const model = this.config.model || "gemini-2.5-pro-preview-tts";

            // Build the multi-speaker text prompt
            const textContent = request.segments
              .map((seg) => {
                const voice = request.voices.get(seg.speaker);
                const styleHint = voice?.stylePrompt
                  ? ` [Style: ${voice.stylePrompt}]`
                  : "";
                return `${seg.speaker}:${styleHint} ${seg.text}`;
              })
              .join("\n\n");

            const contents = [
              {
                role: "user" as const,
                parts: [
                  {
                    text: `Generate a multi-speaker audio with emotional depth for the following script:\n\n${textContent}`,
                  },
                ],
              },
            ];

            await debugLog(
              "\n=== DEBUG: Multi-Speaker Request ===\n" +
                `Seed: ${currentSeed}\n` +
                `Speakers: ${Array.from(request.voices.keys()).join(", ")}\n` +
                `Segments: ${request.segments.length}\n` +
                "\n=== END DEBUG ===\n",
            );

            const response = await this.client!.models.generateContent({
              model,
              config: genConfig,
              contents,
            });

            // Check for blocked content or incomplete generation
            const finishReason = response?.candidates?.[0]?.finishReason;
            const blockReason = response?.promptFeedback?.blockReason;

            if (blockReason) {
              console.log(`request: ${contents}`);
              console.log("Full response for debugging:", response);

              throw new Error(`Content blocked: ${blockReason}`);
            }

            if (finishReason && finishReason !== FinishReason.STOP) {
              console.log(`request: ${contents}`);
              console.log("Full response for debugging:", response);

              throw new Error(`Generation incomplete: ${finishReason}`);
            }

            // Extract audio data from response
            const inlineData =
              response.candidates?.[0]?.content?.parts?.[0]?.inlineData;

            if (!inlineData?.data) {
              return null;
            }

            const mimeType = inlineData.mimeType || "audio/L16;rate=24000";

            // Convert to WAV format
            return convertToWav(inlineData.data, mimeType);
          },
          {
            maxRetries: this.config.maxRetries ?? 3,
            baseDelayMs: 1000,
            maxDelayMs: 30000,
          },
        );

        if (!result) {
          return {
            success: false,
            error: "No audio data received from Gemini API",
          };
        }

        // Ensure output directory exists
        await mkdir(dirname(request.outputPath), { recursive: true });

        // Write audio file
        await writeFile(request.outputPath, result);

        // Get file stats
        const fileStats = await stat(request.outputPath);

        // Estimate duration
        const durationMs = estimateWavDuration(result);

        return {
          success: true,
          audioPath: request.outputPath,
          durationMs,
          fileSize: fileStats.size,
          audioData: result,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check if this is a "Generation incomplete: OTHER" error that we can retry with a different seed
        if (
          errorMessage.includes("Generation incomplete: OTHER") &&
          seedAttempt < maxSeedRetries
        ) {
          currentSeed = baseSeed + seedAttempt + 1;
          console.error(
            `\n⚠️  Multi-speaker generation failed with OTHER, retrying with seed ${currentSeed} (attempt ${seedAttempt + 2}/${maxSeedRetries + 1})`,
          );
          await debugLog(
            `\n=== DEBUG: Retrying multi-speaker with incremented seed ===\n` +
              `Original seed: ${baseSeed}\n` +
              `New seed: ${currentSeed}\n` +
              `Attempt: ${seedAttempt + 2}/${maxSeedRetries + 1}\n` +
              `=== END DEBUG ===\n`,
          );
          continue; // Try again with the new seed
        }

        return {
          success: false,
          error: `Gemini multi-speaker TTS generation failed: ${errorMessage}`,
        };
      }
    }

    // Should not reach here, but just in case
    return {
      success: false,
      error: `Gemini multi-speaker TTS generation failed after ${maxSeedRetries + 1} seed attempts`,
    };
  }

  estimateCost(text: string): number | null {
    // Gemini TTS pricing estimate (as of training data)
    // This is approximate and should be updated based on actual pricing
    const charactersPerDollar = 1000000; // Placeholder
    return text.length / charactersPerDollar;
  }

  getRateLimitInfo(): { requestsPerMinute: number; currentUsage: number } {
    return {
      requestsPerMinute: this.config.rateLimit || 60,
      currentUsage: this.rateLimiter.getCurrentUsage(),
    };
  }
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Create a TTS provider based on configuration
 */
export function createTTSProvider(config: Config): TTSProvider {
  switch (config.provider.name.toLowerCase()) {
    case "gemini":
    case "google":
      return new GeminiTTSProvider(config.provider, config.globalSeed);

    default:
      throw new Error(`Unknown TTS provider: ${config.provider.name}`);
  }
}

/**
 * Generate audio for a segment using the configured provider
 */
export async function generateSegmentAudio(
  provider: TTSProvider,
  segment: Segment,
  config: Config,
  outputPath: string,
): Promise<TTSResponse> {
  const voiceConfig = getVoiceConfig(config, segment.speaker);

  return provider.generateAudio({
    text: segment.text,
    voice: voiceConfig,
    outputPath,
    timeout: config.provider.timeout,
  });
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
