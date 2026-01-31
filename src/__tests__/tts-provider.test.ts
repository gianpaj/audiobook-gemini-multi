/**
 * Tests for the TTS provider module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GeminiTTSProvider,
  createTTSProvider,
  generateSegmentAudio,
  formatDuration,
} from "../tts-provider.js";

import type { Segment, Config, ProviderConfig, VoiceConfig } from "../types.js";
import {
  MINIMAL_CONFIG,
  FULL_CONFIG,
  VOICE_NARRATOR,
} from "../fixtures/configs.js";

// Mock config to control behavior - defined outside vi.mock for access
let mockConfig = {
  shouldFail: false,
  failureMessage: "Mock API failure",
  audioDurationMs: 500,
  finishReason: "STOP" as string | undefined,
  blockReason: undefined as string | undefined,
};

// Helper functions to control mock
function setMockConfig(config: Partial<typeof mockConfig>) {
  mockConfig = { ...mockConfig, ...config };
}

function resetMockConfig() {
  mockConfig = {
    shouldFail: false,
    failureMessage: "Mock API failure",
    audioDurationMs: 500,
    finishReason: "STOP",
    blockReason: undefined,
  };
}

// Mock audio data generator
function createMockAudioData(durationMs: number = 500): string {
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const dataLength = numSamples * (bitsPerSample / 8);
  const data = Buffer.alloc(dataLength, 0);
  return data.toString("base64");
}

const mockGenerateContent = vi.fn(async () => {
  if (mockConfig.shouldFail) {
    throw new Error(mockConfig.failureMessage);
  }

  return {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/L16;rate=24000",
                data: createMockAudioData(mockConfig.audioDurationMs),
              },
            },
          ],
        },
        finishReason: mockConfig.finishReason,
      },
    ],
    promptFeedback: mockConfig.blockReason
      ? { blockReason: mockConfig.blockReason }
      : undefined,
  };
});

// Mock the @google/genai module
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    constructor(options: { apiKey?: string } = {}) {
      if (!options.apiKey) {
        throw new Error("API key is required");
      }
    }

    get models() {
      return {
        generateContent: mockGenerateContent,
      };
    }
  }

  // Mock FinishReason enum
  const FinishReason = {
    FINISH_REASON_UNSPECIFIED: "FINISH_REASON_UNSPECIFIED",
    STOP: "STOP",
    MAX_TOKENS: "MAX_TOKENS",
    SAFETY: "SAFETY",
    RECITATION: "RECITATION",
  };

  // Mock HarmCategory enum
  const HarmCategory = {
    HARM_CATEGORY_UNSPECIFIED: "HARM_CATEGORY_UNSPECIFIED",
    HARM_CATEGORY_HATE_SPEECH: "HARM_CATEGORY_HATE_SPEECH",
    HARM_CATEGORY_SEXUALLY_EXPLICIT: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    HARM_CATEGORY_DANGEROUS_CONTENT: "HARM_CATEGORY_DANGEROUS_CONTENT",
    HARM_CATEGORY_HARASSMENT: "HARM_CATEGORY_HARASSMENT",
  };

  // Mock HarmBlockThreshold enum
  const HarmBlockThreshold = {
    HARM_BLOCK_THRESHOLD_UNSPECIFIED: "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
    BLOCK_LOW_AND_ABOVE: "BLOCK_LOW_AND_ABOVE",
    BLOCK_MEDIUM_AND_ABOVE: "BLOCK_MEDIUM_AND_ABOVE",
    BLOCK_ONLY_HIGH: "BLOCK_ONLY_HIGH",
    BLOCK_NONE: "BLOCK_NONE",
  };

  return {
    GoogleGenAI,
    FinishReason,
    HarmCategory,
    HarmBlockThreshold,
  };
});

// Mock fs/promises
vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

import { vol } from "memfs";

describe("tts-provider", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/output", { recursive: true });
    resetMockConfig();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vol.reset();
    resetMockConfig();
  });

  describe("GeminiTTSProvider", () => {
    describe("constructor", () => {
      it("should create provider with config", () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        expect(provider.name).toBe("gemini");
      });

      it("should accept global seed", () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider, 12345);
        expect(provider.name).toBe("gemini");
      });
    });

    describe("initialize", () => {
      it("should initialize successfully with API key", async () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        await expect(provider.initialize()).resolves.not.toThrow();
      });

      it("should throw error without API key", async () => {
        const configWithoutKey: ProviderConfig = {
          name: "gemini",
          apiKey: undefined,
        };

        // Clear environment variable
        const originalEnv = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const provider = new GeminiTTSProvider(configWithoutKey);
        await expect(provider.initialize()).rejects.toThrow("API key");

        // Restore
        process.env.GEMINI_API_KEY = originalEnv;
      });

      it("should use environment variable if apiKey not in config", async () => {
        const configWithoutKey: ProviderConfig = {
          name: "gemini",
          // No apiKey, will use env var
        };

        // Ensure env var is set
        process.env.GEMINI_API_KEY = "test-key-from-env";

        const provider = new GeminiTTSProvider(configWithoutKey);
        await expect(provider.initialize()).resolves.not.toThrow();
      });
    });

    describe("isAvailable", () => {
      it("should return true when provider can be initialized", async () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        const available = await provider.isAvailable();
        expect(available).toBe(true);
      });

      it("should return false when initialization fails", async () => {
        const configWithoutKey: ProviderConfig = {
          name: "gemini",
          apiKey: undefined,
        };

        const originalEnv = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const provider = new GeminiTTSProvider(configWithoutKey);
        const available = await provider.isAvailable();
        expect(available).toBe(false);

        process.env.GEMINI_API_KEY = originalEnv;
      });
    });

    describe("generateAudio", () => {
      it("should generate audio successfully", async () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        await provider.initialize();

        const response = await provider.generateAudio({
          text: "Hello, world!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/test.wav",
        });

        expect(response.success).toBe(true);
        expect(response.audioPath).toBe("/output/test.wav");
        expect(response.durationMs).toBeGreaterThan(0);
        expect(response.fileSize).toBeGreaterThan(0);
      });

      it("should create output directory if not exists", async () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        await provider.initialize();

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/nested/dir/test.wav",
        });

        expect(response.success).toBe(true);
      });

      it("should include style prompt in generation", async () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        await provider.initialize();

        const voiceWithStyle: VoiceConfig = {
          ...VOICE_NARRATOR,
          stylePrompt: "Speak with enthusiasm",
        };

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: voiceWithStyle,
          outputPath: "/output/test.wav",
        });

        expect(response.success).toBe(true);
        // Verify the API was called
        expect(mockGenerateContent).toHaveBeenCalled();
      });

      it("should handle API failure", async () => {
        setMockConfig({
          shouldFail: true,
          failureMessage: "Rate limit exceeded",
        });

        const provider = new GeminiTTSProvider({
          ...MINIMAL_CONFIG.provider,
          maxRetries: 0, // Disable retries for this test
        });
        await provider.initialize();

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/test.wav",
        });

        expect(response.success).toBe(false);
        expect(response.error).toContain("Rate limit exceeded");
      });

      it("should handle blocked content", async () => {
        setMockConfig({
          blockReason: "SAFETY",
        });

        const provider = new GeminiTTSProvider({
          ...MINIMAL_CONFIG.provider,
          maxRetries: 0,
        });
        await provider.initialize();

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/test.wav",
        });

        expect(response.success).toBe(false);
        expect(response.error).toContain("Content blocked: SAFETY");
      });

      it("should handle incomplete generation", async () => {
        setMockConfig({
          finishReason: "MAX_TOKENS",
        });

        const provider = new GeminiTTSProvider({
          ...MINIMAL_CONFIG.provider,
          maxRetries: 0,
        });
        await provider.initialize();

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/test.wav",
        });

        expect(response.success).toBe(false);
        expect(response.error).toContain("Generation incomplete: MAX_TOKENS");
      });

      it("should handle SAFETY finish reason", async () => {
        setMockConfig({
          finishReason: "SAFETY",
        });

        const provider = new GeminiTTSProvider({
          ...MINIMAL_CONFIG.provider,
          maxRetries: 0,
        });
        await provider.initialize();

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/test.wav",
        });

        expect(response.success).toBe(false);
        expect(response.error).toContain("Generation incomplete: SAFETY");
      });

      it("should retry with incremented seed on Generation incomplete: OTHER", async () => {
        // Track how many times generateContent is called
        let callCount = 0;
        const originalMockFn = mockGenerateContent.getMockImplementation();

        mockGenerateContent.mockImplementation(async () => {
          callCount++;
          // Fail with OTHER on first 2 attempts, succeed on 3rd
          if (callCount <= 2) {
            return {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: "audio/L16;rate=24000",
                          data: createMockAudioData(500),
                        },
                      },
                    ],
                  },
                  finishReason: "OTHER",
                },
              ],
              promptFeedback: undefined,
            };
          }
          // Succeed on 3rd attempt
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/L16;rate=24000",
                        data: createMockAudioData(500),
                      },
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            promptFeedback: undefined,
          };
        });

        const provider = new GeminiTTSProvider({
          ...MINIMAL_CONFIG.provider,
          maxRetries: 0, // Disable normal retries, we're testing seed increment retry
        });
        await provider.initialize();

        // Capture console.error output
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: { ...VOICE_NARRATOR, seed: 100 },
          outputPath: "/output/test.wav",
        });

        // Should succeed after retrying with different seeds
        expect(response.success).toBe(true);
        expect(callCount).toBe(3); // Failed twice, succeeded on 3rd

        // Verify retry messages were printed
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("retrying with seed 101"),
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("retrying with seed 102"),
        );

        consoleErrorSpy.mockRestore();
        if (originalMockFn) {
          mockGenerateContent.mockImplementation(originalMockFn);
        }
      });

      it("should fail after max seed retries on Generation incomplete: OTHER", async () => {
        setMockConfig({
          finishReason: "OTHER",
        });

        const provider = new GeminiTTSProvider({
          ...MINIMAL_CONFIG.provider,
          maxRetries: 0, // Disable normal retries
        });
        await provider.initialize();

        // Suppress console.error for cleaner test output
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const response = await provider.generateAudio({
          text: "Hello!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/test.wav",
        });

        // Should fail after exhausting all seed retries
        expect(response.success).toBe(false);
        expect(response.error).toContain("Generation incomplete: OTHER");

        // Should have tried 4 times (original + 3 seed retries)
        expect(mockGenerateContent).toHaveBeenCalledTimes(4);

        consoleErrorSpy.mockRestore();
      });

      it("should write valid WAV file", async () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        await provider.initialize();

        await provider.generateAudio({
          text: "Hello!",
          voice: VOICE_NARRATOR,
          outputPath: "/output/test.wav",
        });

        // Read the file and verify it's a valid WAV
        const fileContent = vol.readFileSync("/output/test.wav") as Buffer;
        expect(fileContent.toString("ascii", 0, 4)).toBe("RIFF");
        expect(fileContent.toString("ascii", 8, 12)).toBe("WAVE");
      });
    });

    describe("estimateCost", () => {
      it("should return a cost estimate", () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        const cost = provider.estimateCost("Hello, this is a test message.");

        expect(cost).not.toBeNull();
        expect(typeof cost).toBe("number");
        expect(cost).toBeGreaterThanOrEqual(0);
      });

      it("should scale with text length", () => {
        const provider = new GeminiTTSProvider(MINIMAL_CONFIG.provider);
        const shortCost = provider.estimateCost("Short");
        const longCost = provider.estimateCost(
          "This is a much longer text message.",
        );

        expect(longCost).toBeGreaterThan(shortCost!);
      });
    });

    describe("getRateLimitInfo", () => {
      it("should return rate limit information", () => {
        const provider = new GeminiTTSProvider({
          ...MINIMAL_CONFIG.provider,
          rateLimit: 100,
        });

        const info = provider.getRateLimitInfo();

        expect(info.requestsPerMinute).toBe(100);
        expect(info.currentUsage).toBe(0);
      });

      it("should use default rate limit if not specified", () => {
        const provider = new GeminiTTSProvider({
          name: "gemini",
          apiKey: "test-key",
        });

        const info = provider.getRateLimitInfo();

        expect(info.requestsPerMinute).toBe(60); // Default
      });
    });
  });

  describe("createTTSProvider", () => {
    it("should create Gemini provider for gemini config", () => {
      const provider = createTTSProvider(MINIMAL_CONFIG);

      expect(provider).toBeInstanceOf(GeminiTTSProvider);
      expect(provider.name).toBe("gemini");
    });

    it("should create Gemini provider for google config", () => {
      const config: Config = {
        ...MINIMAL_CONFIG,
        provider: {
          ...MINIMAL_CONFIG.provider,
          name: "google",
        },
      };

      const provider = createTTSProvider(config);
      expect(provider.name).toBe("gemini");
    });

    it("should throw error for unknown provider", () => {
      const config: Config = {
        ...MINIMAL_CONFIG,
        provider: {
          ...MINIMAL_CONFIG.provider,
          name: "unknown-provider",
        },
      };

      expect(() => createTTSProvider(config)).toThrow("Unknown TTS provider");
    });

    it("should pass globalSeed to provider", () => {
      const config: Config = {
        ...MINIMAL_CONFIG,
        globalSeed: 99999,
      };

      const provider = createTTSProvider(config);
      expect(provider).toBeDefined();
    });
  });

  describe("generateSegmentAudio", () => {
    const mockSegment: Segment = {
      id: "seg_0001_abc123",
      index: 0,
      speaker: "NARRATOR",
      text: "Once upon a time...",
      lineNumber: 1,
    };

    it("should generate audio for a segment", async () => {
      const provider = createTTSProvider(FULL_CONFIG);
      await provider.initialize();

      const response = await generateSegmentAudio(
        provider,
        mockSegment,
        FULL_CONFIG,
        "/output/segment.wav",
      );

      expect(response.success).toBe(true);
      expect(response.audioPath).toBe("/output/segment.wav");
    });

    it("should use voice config from config file", async () => {
      const provider = createTTSProvider(FULL_CONFIG);
      await provider.initialize();

      const response = await generateSegmentAudio(
        provider,
        mockSegment,
        FULL_CONFIG,
        "/output/segment.wav",
      );

      expect(response.success).toBe(true);
      // NARRATOR is configured in FULL_CONFIG with specific voice
    });

    it("should handle unknown speaker gracefully", async () => {
      const unknownSpeakerSegment: Segment = {
        ...mockSegment,
        speaker: "UNKNOWN_CHARACTER",
      };

      const provider = createTTSProvider(MINIMAL_CONFIG);
      await provider.initialize();

      const response = await generateSegmentAudio(
        provider,
        unknownSpeakerSegment,
        MINIMAL_CONFIG,
        "/output/segment.wav",
      );

      expect(response.success).toBe(true);
    });
  });

  describe("formatDuration", () => {
    it("should format seconds", () => {
      expect(formatDuration(5000)).toBe("5s");
      expect(formatDuration(45000)).toBe("45s");
    });

    it("should format minutes and seconds", () => {
      expect(formatDuration(60000)).toBe("1m 0s");
      expect(formatDuration(90000)).toBe("1m 30s");
      expect(formatDuration(125000)).toBe("2m 5s");
    });

    it("should format hours, minutes, and seconds", () => {
      expect(formatDuration(3600000)).toBe("1h 0m 0s");
      expect(formatDuration(3661000)).toBe("1h 1m 1s");
      expect(formatDuration(7325000)).toBe("2h 2m 5s");
    });

    it("should handle zero", () => {
      expect(formatDuration(0)).toBe("0s");
    });
  });
});
