/**
 * Mock for @google/genai package
 *
 * This mock provides a fake implementation of the Gemini API
 * for testing the TTS provider without making real API calls.
 */

import { vi } from "vitest";

/**
 * Mock audio data generator
 */
function createMockAudioData(durationMs: number = 500): string {
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const dataLength = numSamples * (bitsPerSample / 8);
  const data = Buffer.alloc(dataLength, 0);
  return data.toString("base64");
}

/**
 * Mock response chunk with audio data
 */
function createMockAudioChunk(durationMs: number = 500) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/L16;rate=24000",
                data: createMockAudioData(durationMs),
              },
            },
          ],
        },
      },
    ],
  };
}

/**
 * Mock response chunk with text (for non-audio responses)
 */
function createMockTextChunk(text: string) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text,
            },
          ],
        },
      },
    ],
    text: () => text,
  };
}

/**
 * Mock async generator for streaming responses
 */
async function* mockAudioStream(durationMs: number = 500) {
  yield createMockAudioChunk(durationMs);
}

async function* mockTextStream(text: string) {
  yield createMockTextChunk(text);
}

/**
 * Mock error responses
 */
export class MockApiError extends Error {
  constructor(
    message: string,
    public code: number = 500,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Configuration for mock behavior
 */
export interface MockConfig {
  shouldFail?: boolean;
  failureMessage?: string;
  failureCode?: number;
  responseDelay?: number;
  audioDurationMs?: number;
  returnText?: boolean;
  textResponse?: string;
}

// Global mock configuration (can be changed per test)
let mockConfig: MockConfig = {
  shouldFail: false,
  audioDurationMs: 500,
  returnText: false,
};

/**
 * Set mock configuration for tests
 */
export function setMockConfig(config: Partial<MockConfig>) {
  mockConfig = { ...mockConfig, ...config };
}

/**
 * Reset mock configuration to defaults
 */
export function resetMockConfig() {
  mockConfig = {
    shouldFail: false,
    audioDurationMs: 500,
    returnText: false,
  };
}

/**
 * Get current mock configuration
 */
export function getMockConfig(): MockConfig {
  return { ...mockConfig };
}

/**
 * Mock GenerateContentConfig type
 */
export interface GenerateContentConfig {
  temperature?: number;
  responseModalities?: string[];
  speechConfig?: {
    voiceConfig?: {
      prebuiltVoiceConfig?: {
        voiceName?: string;
      };
    };
    multiSpeakerVoiceConfig?: {
      speakerVoiceConfigs?: Array<{
        speaker: string;
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: string;
          };
        };
      }>;
    };
  };
  seed?: number;
}

/**
 * Mock models object
 */
const mockModels = {
  generateContentStream: vi.fn(
    async (_params: {
      model: string;
      config: GenerateContentConfig;
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    }) => {
      // Add artificial delay if configured
      if (mockConfig.responseDelay) {
        await new Promise((resolve) =>
          setTimeout(resolve, mockConfig.responseDelay),
        );
      }

      // Simulate failure if configured
      if (mockConfig.shouldFail) {
        throw new MockApiError(
          mockConfig.failureMessage || "Mock API failure",
          mockConfig.failureCode || 500,
        );
      }

      // Return text stream if configured
      if (mockConfig.returnText) {
        return mockTextStream(mockConfig.textResponse || "Mock text response");
      }

      // Return audio stream
      return mockAudioStream(mockConfig.audioDurationMs);
    },
  ),

  generateContent: vi.fn(
    async (_params: {
      model: string;
      config: GenerateContentConfig;
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    }) => {
      // Add artificial delay if configured
      if (mockConfig.responseDelay) {
        await new Promise((resolve) =>
          setTimeout(resolve, mockConfig.responseDelay),
        );
      }

      // Simulate failure if configured
      if (mockConfig.shouldFail) {
        throw new MockApiError(
          mockConfig.failureMessage || "Mock API failure",
          mockConfig.failureCode || 500,
        );
      }

      // Return text response if configured
      if (mockConfig.returnText) {
        return createMockTextChunk(
          mockConfig.textResponse || "Mock text response",
        );
      }

      // Return audio response
      return createMockAudioChunk(mockConfig.audioDurationMs);
    },
  ),
};

/**
 * Mock GoogleGenAI class
 */
export class GoogleGenAI {
  private apiKey: string;

  constructor(options: { apiKey?: string } = {}) {
    this.apiKey = options.apiKey || "";

    if (!this.apiKey) {
      throw new Error("API key is required");
    }
  }

  get models() {
    return mockModels;
  }
}

/**
 * Export mock functions for test assertions
 */
export const mockGenerateContentStream = mockModels.generateContentStream;
export const mockGenerateContent = mockModels.generateContent;

/**
 * Helper to get call history
 */
export function getGenerateContentStreamCalls() {
  return mockModels.generateContentStream.mock.calls;
}

export function getGenerateContentCalls() {
  return mockModels.generateContent.mock.calls;
}

/**
 * Clear all mock call history
 */
export function clearMockCalls() {
  mockModels.generateContentStream.mockClear();
  mockModels.generateContent.mockClear();
}

// Default export for compatibility
export default {
  GoogleGenAI,
  setMockConfig,
  resetMockConfig,
  getMockConfig,
  mockGenerateContentStream,
  mockGenerateContent,
  getGenerateContentStreamCalls,
  getGenerateContentCalls,
  clearMockCalls,
  MockApiError,
};
