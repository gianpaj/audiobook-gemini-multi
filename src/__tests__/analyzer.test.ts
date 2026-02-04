/**
 * Tests for the analyzer module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  analyzeStory,
  formatAnalysisResult,
  getSpeakerListForConvert,
  getAnalysisPrompt,
  getSupportedProviders,
  getDefaultModel,
  getApiKeyEnvVar,
  getDefaultModelId,
  type AnalysisResult,
} from "../analyzer.js";

// Mock config to control behavior
let mockConfig = {
  shouldFail: false,
  failureMessage: "Mock API failure",
  responseText: "",
};

function setMockConfig(config: Partial<typeof mockConfig>) {
  mockConfig = { ...mockConfig, ...config };
}

function resetMockConfig() {
  mockConfig = {
    shouldFail: false,
    failureMessage: "Mock API failure",
    responseText: "",
  };
}

// Mock the @ai-sdk/google module
vi.mock("@ai-sdk/google", () => {
  return {
    createGoogleGenerativeAI: vi.fn((options?: { apiKey?: string }) => {
      // Return a function that creates model configs
      return (model: string) => {
        return { model, provider: "google", apiKey: options?.apiKey };
      };
    }),
  };
});

// Mock the ai SDK
vi.mock("ai", () => {
  return {
    createProviderRegistry: vi.fn((providers: Record<string, unknown>) => {
      return {
        languageModel: (modelId: string) => {
          const [provider, model] = modelId.split(":");
          if (!providers[provider]) {
            throw new Error(`Provider ${provider} not found in registry`);
          }
          return { provider, model, modelId };
        },
      };
    }),
    generateText: vi.fn(async () => {
      if (mockConfig.shouldFail) {
        throw new Error(mockConfig.failureMessage);
      }

      return {
        text: mockConfig.responseText,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      };
    }),
  };
});

// Mock the @ai-sdk/xai module
vi.mock("@ai-sdk/xai", () => {
  return {
    createXai: vi.fn((options?: { apiKey?: string }) => {
      // Return a function that creates model configs
      return (model: string) => {
        return { model, provider: "xai", apiKey: options?.apiKey };
      };
    }),
  };
});

describe("analyzer", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetMockConfig();
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GEMINI_API_KEY: "test-api-key",
      XAI_API_KEY: "test-xai-key",
    };
  });

  afterEach(() => {
    resetMockConfig();
    process.env = originalEnv;
  });

  describe("analyzeStory", () => {
    it("should return error when no API key is provided for Gemini", async () => {
      delete process.env.GEMINI_API_KEY;

      const result = await analyzeStory("Some text");

      expect(result.success).toBe(false);
      expect(result.error).toContain("API key is required");
      expect(result.error).toContain("GEMINI_API_KEY");
    });

    it("should return error when no API key is provided for Grok", async () => {
      delete process.env.XAI_API_KEY;

      const result = await analyzeStory("Some text", {
        model: "grok:grok-4-1-fast-reasoning",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("API key is required");
      expect(result.error).toContain("XAI_API_KEY");
    });

    it("should successfully analyze text and return characters with default model", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [
            {
              name: "NARRATOR",
              gender: "neutral",
              description: "Third person narrator",
              confidence: "high",
            },
            {
              name: "CLARA",
              gender: "female",
              description: "Young woman protagonist",
              confidence: "high",
            },
            {
              name: "LIBRARIAN",
              gender: "male",
              description: "Elderly man with spectacles",
              confidence: "high",
            },
          ],
        }),
      });

      const result = await analyzeStory("Sample story text");

      expect(result.success).toBe(true);
      expect(result.characters).toHaveLength(3);
      expect(result.characters?.[0].name).toBe("NARRATOR");
      expect(result.characters?.[1].name).toBe("CLARA");
      expect(result.characters?.[1].gender).toBe("female");
      expect(result.characters?.[2].name).toBe("LIBRARIAN");
      expect(result.characters?.[2].gender).toBe("male");
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.outputTokens).toBe(50);
      expect(result.model).toBe("gemini:gemini-3-pro-preview");
    });

    it("should use Grok when model is specified with grok prefix", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [
            { name: "VILLAIN", gender: "female", confidence: "high" },
          ],
        }),
      });

      const result = await analyzeStory("Sample text", {
        model: "grok:grok-4-1-fast-reasoning",
      });

      expect(result.success).toBe(true);
      expect(result.characters?.[0].name).toBe("VILLAIN");
      expect(result.model).toBe("grok:grok-4-1-fast-reasoning");
    });

    it("should use Gemini when model is specified with gemini prefix", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [{ name: "HERO", gender: "male", confidence: "high" }],
        }),
      });

      const result = await analyzeStory("Sample text", {
        model: "gemini:gemini-3-pro-preview",
      });

      expect(result.success).toBe(true);
      expect(result.characters?.[0].name).toBe("HERO");
      expect(result.model).toBe("gemini:gemini-3-pro-preview");
    });

    it("should infer provider from model name without prefix", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [{ name: "TEST", gender: "neutral", confidence: "high" }],
        }),
      });

      // Model starting with "grok" should use grok provider
      const result = await analyzeStory("Sample text", {
        model: "grok-4-1-fast-reasoning",
      });

      expect(result.success).toBe(true);
      expect(result.model).toBe("grok:grok-4-1-fast-reasoning");
    });

    it("should handle JSON wrapped in markdown code blocks", async () => {
      setMockConfig({
        responseText:
          '```json\n{"characters": [{"name": "BOB", "gender": "male", "confidence": "high"}]}\n```',
      });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(true);
      expect(result.characters).toHaveLength(1);
      expect(result.characters?.[0].name).toBe("BOB");
    });

    it("should return error when no content received", async () => {
      setMockConfig({ responseText: "" });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(false);
      expect(result.error).toContain("No content received from LLM");
    });

    it("should return error on invalid JSON response", async () => {
      setMockConfig({ responseText: "This is not valid JSON" });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to parse LLM response");
    });

    it("should return error when characters array is missing", async () => {
      setMockConfig({
        responseText: JSON.stringify({ something: "else" }),
      });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing characters array");
    });

    it("should handle API errors gracefully", async () => {
      setMockConfig({
        shouldFail: true,
        failureMessage: "API rate limit exceeded",
      });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Analysis failed");
      expect(result.error).toContain("API rate limit exceeded");
    });

    it("should normalize character names to uppercase", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [
            { name: "alice", gender: "female", confidence: "high" },
            { name: "Bob Smith", gender: "male", confidence: "medium" },
          ],
        }),
      });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(true);
      expect(result.characters?.[0].name).toBe("ALICE");
      expect(result.characters?.[1].name).toBe("BOB_SMITH");
    });

    it("should normalize gender values", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [
            { name: "CHAR1", gender: "f", confidence: "high" },
            { name: "CHAR2", gender: "woman", confidence: "high" },
            { name: "CHAR3", gender: "m", confidence: "high" },
            { name: "CHAR4", gender: "boy", confidence: "high" },
            { name: "CHAR5", gender: "unknown", confidence: "high" },
          ],
        }),
      });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(true);
      expect(result.characters?.[0].gender).toBe("female");
      expect(result.characters?.[1].gender).toBe("female");
      expect(result.characters?.[2].gender).toBe("male");
      expect(result.characters?.[3].gender).toBe("male");
      expect(result.characters?.[4].gender).toBe("neutral");
    });

    it("should normalize confidence values", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [
            { name: "CHAR1", gender: "female", confidence: "h" },
            { name: "CHAR2", gender: "male", confidence: "l" },
            { name: "CHAR3", gender: "neutral", confidence: "something" },
          ],
        }),
      });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(true);
      expect(result.characters?.[0].confidence).toBe("high");
      expect(result.characters?.[1].confidence).toBe("low");
      expect(result.characters?.[2].confidence).toBe("medium");
    });

    it("should skip characters without names", async () => {
      setMockConfig({
        responseText: JSON.stringify({
          characters: [
            { name: "VALID", gender: "female", confidence: "high" },
            { gender: "male", confidence: "high" },
            { name: "", gender: "neutral", confidence: "medium" },
            { name: 123, gender: "male", confidence: "low" },
          ],
        }),
      });

      const result = await analyzeStory("Sample text");

      expect(result.success).toBe(true);
      expect(result.characters).toHaveLength(1);
      expect(result.characters?.[0].name).toBe("VALID");
    });
  });

  describe("getSupportedProviders", () => {
    it("should return list of supported providers", () => {
      const providers = getSupportedProviders();

      expect(providers).toContain("gemini");
      expect(providers).toContain("grok");
      expect(providers).toHaveLength(2);
    });
  });

  describe("getDefaultModel", () => {
    it("should return default model for Gemini", () => {
      const model = getDefaultModel("gemini");

      expect(model).toBe("gemini-3-pro-preview");
    });

    it("should return default model for Grok", () => {
      const model = getDefaultModel("grok");

      expect(model).toBe("grok-4-1-fast-reasoning");
    });
  });

  describe("getApiKeyEnvVar", () => {
    it("should return env var name for Gemini", () => {
      const envVar = getApiKeyEnvVar("gemini");

      expect(envVar).toBe("GEMINI_API_KEY");
    });

    it("should return env var name for Grok", () => {
      const envVar = getApiKeyEnvVar("grok");

      expect(envVar).toBe("XAI_API_KEY");
    });
  });

  describe("getDefaultModelId", () => {
    it("should return default model ID for Gemini", () => {
      const modelId = getDefaultModelId("gemini");

      expect(modelId).toBe("gemini:gemini-3-pro-preview");
    });

    it("should return default model ID for Grok", () => {
      const modelId = getDefaultModelId("grok");

      expect(modelId).toBe("grok:grok-4-1-fast-reasoning");
    });

    it("should default to Gemini when no provider specified", () => {
      const modelId = getDefaultModelId();

      expect(modelId).toBe("gemini:gemini-3-pro-preview");
    });
  });

  describe("formatAnalysisResult", () => {
    it("should format successful result grouped by gender", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          {
            name: "ALICE",
            gender: "female",
            description: "Young protagonist",
            confidence: "high",
          },
          {
            name: "BOB",
            gender: "male",
            description: "Sidekick",
            confidence: "medium",
          },
          { name: "NARRATOR", gender: "neutral", confidence: "high" },
        ],
      };

      const formatted = formatAnalysisResult(result);

      expect(formatted).toContain("Female:");
      expect(formatted).toContain("ALICE");
      expect(formatted).toContain("Young protagonist");
      expect(formatted).toContain("Male:");
      expect(formatted).toContain("BOB");
      expect(formatted).toContain("Neutral/Unknown:");
      expect(formatted).toContain("NARRATOR");
    });

    it("should format failed result with error message", () => {
      const result: AnalysisResult = {
        success: false,
        error: "Something went wrong",
      };

      const formatted = formatAnalysisResult(result);

      expect(formatted).toContain("Analysis failed");
      expect(formatted).toContain("Something went wrong");
    });

    it("should handle result with missing characters", () => {
      const result: AnalysisResult = {
        success: true,
        characters: undefined,
      };

      const formatted = formatAnalysisResult(result);

      expect(formatted).toContain("Analysis failed");
    });

    it("should handle empty character list", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [],
      };

      const formatted = formatAnalysisResult(result);

      // Should return empty or minimal output
      expect(formatted).toBe("");
    });

    it("should include confidence levels", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          { name: "CHAR1", gender: "female", confidence: "high" },
          { name: "CHAR2", gender: "male", confidence: "low" },
        ],
      };

      const formatted = formatAnalysisResult(result);

      expect(formatted).toContain("high confidence");
      expect(formatted).toContain("low confidence");
    });
  });

  describe("getSpeakerListForConvert", () => {
    it("should return comma-separated list of speaker names", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          { name: "NARRATOR", gender: "neutral", confidence: "high" },
          { name: "ALICE", gender: "female", confidence: "high" },
          { name: "BOB", gender: "male", confidence: "medium" },
        ],
      };

      const speakersList = getSpeakerListForConvert(result);

      expect(speakersList).toBe("NARRATOR,ALICE,BOB");
    });

    it("should return empty string for failed result", () => {
      const result: AnalysisResult = {
        success: false,
        error: "Failed",
      };

      const speakersList = getSpeakerListForConvert(result);

      expect(speakersList).toBe("");
    });

    it("should return empty string when no characters", () => {
      const result: AnalysisResult = {
        success: true,
        characters: undefined,
      };

      const speakersList = getSpeakerListForConvert(result);

      expect(speakersList).toBe("");
    });

    it("should handle single character", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          { name: "NARRATOR", gender: "neutral", confidence: "high" },
        ],
      };

      const speakersList = getSpeakerListForConvert(result);

      expect(speakersList).toBe("NARRATOR");
    });
  });

  describe("getAnalysisPrompt", () => {
    it("should return system and user prompts", () => {
      const { systemPrompt, userPrompt } = getAnalysisPrompt("Sample text");

      expect(systemPrompt).toContain("text analyzer");
      expect(systemPrompt).toContain("gender");
      expect(systemPrompt).toContain("JSON");
      expect(userPrompt).toContain("Sample text");
      expect(userPrompt).toContain("NARRATOR");
    });

    it("should exclude narrator instruction when option is false", () => {
      const { userPrompt } = getAnalysisPrompt("Sample text", {
        includeNarrator: false,
      });

      expect(userPrompt).toContain("Do NOT include a NARRATOR");
    });

    it("should include narrator instruction by default", () => {
      const { userPrompt } = getAnalysisPrompt("Sample text");

      expect(userPrompt).toContain(
        "Include a NARRATOR entry if there is any narration",
      );
    });
  });
});
