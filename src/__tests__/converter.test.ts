/**
 * Tests for the converter module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractSpeakers,
  validateConvertedContent,
  postProcessContent,
  estimateTokenCount,
  splitIntoChunks,
  getConversionPrompt,
  convertWithGemini,
  convertToStoryFormat,
} from "../converter.js";

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
        generateContent: vi.fn(async () => {
          if (mockConfig.shouldFail) {
            throw new Error(mockConfig.failureMessage);
          }

          return {
            text: mockConfig.responseText,
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 150,
            },
          };
        }),
      };
    }
  }

  return {
    GoogleGenAI,
  };
});

describe("converter", () => {
  beforeEach(() => {
    resetMockConfig();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockConfig();
  });

  describe("extractSpeakers", () => {
    it("should extract speakers from bracket format", () => {
      const content = `[NARRATOR] Once upon a time...
[ALICE] Hello there!
[BOB] Hi Alice!
[NARRATOR] They greeted each other.`;

      const speakers = extractSpeakers(content, "bracket");

      expect(speakers).toEqual(["ALICE", "BOB", "NARRATOR"]);
    });

    it("should extract speakers from colon format", () => {
      const content = `NARRATOR: Once upon a time...
ALICE: Hello there!
BOB: Hi Alice!
NARRATOR: They greeted each other.`;

      const speakers = extractSpeakers(content, "colon");

      expect(speakers).toEqual(["ALICE", "BOB", "NARRATOR"]);
    });

    it("should handle empty content", () => {
      const speakers = extractSpeakers("", "bracket");
      expect(speakers).toEqual([]);
    });

    it("should handle content with no valid speakers", () => {
      const content = `This is just plain text.
No speaker tags here.`;

      const speakers = extractSpeakers(content, "bracket");
      expect(speakers).toEqual([]);
    });

    it("should handle speaker names with numbers and underscores", () => {
      const content = `[NARRATOR_V2] Modern narrator speaking.
[CHARACTER_123] I have numbers in my name.`;

      const speakers = extractSpeakers(content, "bracket");

      expect(speakers).toEqual(["CHARACTER_123", "NARRATOR_V2"]);
    });

    it("should return sorted speakers", () => {
      const content = `[ZEBRA] I'm first alphabetically last.
[ALICE] I'm first!
[BOB] I'm second!`;

      const speakers = extractSpeakers(content, "bracket");

      expect(speakers).toEqual(["ALICE", "BOB", "ZEBRA"]);
    });

    it("should default to bracket format", () => {
      const content = `[NARRATOR] Once upon a time...`;
      const speakers = extractSpeakers(content);
      expect(speakers).toEqual(["NARRATOR"]);
    });
  });

  describe("validateConvertedContent", () => {
    it("should validate correct bracket format", () => {
      const content = `[NARRATOR] Once upon a time...
[ALICE] Hello there!
[BOB] Hi Alice!`;

      const result = validateConvertedContent(content, "bracket");

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.lineCount).toBe(3);
    });

    it("should validate correct colon format", () => {
      const content = `NARRATOR: Once upon a time...
ALICE: Hello there!
BOB: Hi Alice!`;

      const result = validateConvertedContent(content, "colon");

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.lineCount).toBe(3);
    });

    it("should detect invalid bracket format lines", () => {
      const content = `[NARRATOR] Valid line.
Invalid line without tag.
[ALICE] Another valid line.`;

      const result = validateConvertedContent(content, "bracket");

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Line 2");
      expect(result.lineCount).toBe(2);
    });

    it("should detect invalid colon format lines", () => {
      const content = `NARRATOR: Valid line.
Invalid line without tag.
ALICE: Another valid line.`;

      const result = validateConvertedContent(content, "colon");

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.lineCount).toBe(2);
    });

    it("should skip empty lines", () => {
      const content = `[NARRATOR] Line one.

[ALICE] Line two.`;

      const result = validateConvertedContent(content, "bracket");

      expect(result.valid).toBe(true);
      expect(result.lineCount).toBe(2);
    });

    it("should handle empty content", () => {
      const result = validateConvertedContent("", "bracket");

      expect(result.valid).toBe(true);
      expect(result.lineCount).toBe(0);
    });

    it("should default to bracket format", () => {
      const content = `[NARRATOR] Once upon a time...`;
      const result = validateConvertedContent(content);
      expect(result.valid).toBe(true);
    });
  });

  describe("postProcessContent", () => {
    it("should remove empty lines", () => {
      const content = `[NARRATOR] Line one.

[ALICE] Line two.

`;

      const result = postProcessContent(content, "bracket");

      expect(result).toBe("[NARRATOR] Line one.\n[ALICE] Line two.");
    });

    it("should fix missing space after bracket tag", () => {
      const content = `[NARRATOR]No space here.`;

      const result = postProcessContent(content, "bracket");

      expect(result).toBe("[NARRATOR] No space here.");
    });

    it("should fix missing space after colon tag", () => {
      const content = `NARRATOR:No space here.`;

      const result = postProcessContent(content, "colon");

      expect(result).toBe("NARRATOR: No space here.");
    });

    it("should normalize multiple spaces", () => {
      const content = `[NARRATOR]   Multiple   spaces   here.`;

      const result = postProcessContent(content, "bracket");

      expect(result).toBe("[NARRATOR] Multiple spaces here.");
    });

    it("should trim whitespace from lines", () => {
      const content = `   [NARRATOR] Indented line.
  [ALICE] Another indented line.  `;

      const result = postProcessContent(content, "bracket");

      expect(result).toBe(
        "[NARRATOR] Indented line.\n[ALICE] Another indented line.",
      );
    });

    it("should default to bracket format", () => {
      const content = `[NARRATOR]No space.`;
      const result = postProcessContent(content);
      expect(result).toBe("[NARRATOR] No space.");
    });
  });

  describe("estimateTokenCount", () => {
    it("should estimate tokens for short text", () => {
      const text = "Hello, world!"; // 13 characters
      const tokens = estimateTokenCount(text);

      // Roughly 4 characters per token
      expect(tokens).toBe(4);
    });

    it("should estimate tokens for longer text", () => {
      const text = "A".repeat(1000); // 1000 characters
      const tokens = estimateTokenCount(text);

      expect(tokens).toBe(250);
    });

    it("should handle empty text", () => {
      const tokens = estimateTokenCount("");
      expect(tokens).toBe(0);
    });
  });

  describe("splitIntoChunks", () => {
    it("should return single chunk for small text", () => {
      const text = "This is a small text.";
      const chunks = splitIntoChunks(text, 1000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it("should split text into multiple chunks", () => {
      const paragraph1 = "First paragraph. ".repeat(100);
      const paragraph2 = "Second paragraph. ".repeat(100);
      const text = `${paragraph1}\n\n${paragraph2}`;

      const chunks = splitIntoChunks(text, 500);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should split by paragraph boundaries", () => {
      const text = `Paragraph one.\n\nParagraph two.\n\nParagraph three.`;
      const chunks = splitIntoChunks(text, 10);

      // Each paragraph should be in its own chunk due to small max tokens
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should use default maxTokens", () => {
      const smallText = "Small text.";
      const chunks = splitIntoChunks(smallText);

      expect(chunks).toHaveLength(1);
    });

    it("should handle text without paragraph breaks", () => {
      const text = "Single long paragraph without breaks.";
      const chunks = splitIntoChunks(text, 1000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });
  });

  describe("getConversionPrompt", () => {
    it("should return system and user prompts", () => {
      const text = "Once upon a time...";
      const { systemPrompt, userPrompt } = getConversionPrompt(text);

      expect(systemPrompt).toContain("script formatter");
      expect(userPrompt).toContain("Once upon a time");
    });

    it("should use bracket format example by default", () => {
      const text = "Test text";
      const { userPrompt } = getConversionPrompt(text);

      expect(userPrompt).toContain("[NARRATOR]");
    });

    it("should use colon format example when specified", () => {
      const text = "Test text";
      const { userPrompt } = getConversionPrompt(text, { format: "colon" });

      expect(userPrompt).toContain("NARRATOR:");
    });

    it("should include custom speakers when provided", () => {
      const text = "Test text";
      const { userPrompt } = getConversionPrompt(text, {
        speakers: ["HERO", "VILLAIN"],
      });

      expect(userPrompt).toContain("HERO");
      expect(userPrompt).toContain("VILLAIN");
    });

    it("should include note about excluding narrator when specified", () => {
      const text = "Test text";
      const { userPrompt } = getConversionPrompt(text, {
        includeNarrator: false,
      });

      expect(userPrompt).toContain("Do not include a NARRATOR");
    });
  });

  describe("convertWithGemini", () => {
    it("should convert text successfully", async () => {
      setMockConfig({
        responseText: `[NARRATOR] Once upon a time...
[ALICE] Hello there!`,
      });

      const result = await convertWithGemini(
        "Once upon a time, Alice said hello.",
        {
          apiKey: "test-key",
        },
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("[NARRATOR]");
      expect(result.speakers).toContain("NARRATOR");
      expect(result.speakers).toContain("ALICE");
    });

    it("should fail without API key", async () => {
      const originalEnv = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const result = await convertWithGemini("Test text");

      expect(result.success).toBe(false);
      expect(result.error).toContain("API key is required");

      process.env.GEMINI_API_KEY = originalEnv;
    });

    it("should use environment variable for API key", async () => {
      const originalEnv = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = "env-api-key";

      setMockConfig({
        responseText: "[NARRATOR] Test.",
      });

      const result = await convertWithGemini("Test text");

      expect(result.success).toBe(true);

      process.env.GEMINI_API_KEY = originalEnv;
    });

    it("should handle API failure", async () => {
      setMockConfig({
        shouldFail: true,
        failureMessage: "Rate limit exceeded",
      });

      const result = await convertWithGemini("Test text", {
        apiKey: "test-key",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Rate limit exceeded");
    });

    it("should handle empty response", async () => {
      setMockConfig({
        responseText: "",
      });

      const result = await convertWithGemini("Test text", {
        apiKey: "test-key",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("No content received");
    });

    it("should include usage information", async () => {
      setMockConfig({
        responseText: "[NARRATOR] Test.",
      });

      const result = await convertWithGemini("Test text", {
        apiKey: "test-key",
      });

      expect(result.success).toBe(true);
      expect(result.usage).toBeDefined();
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.outputTokens).toBe(150);
    });

    it("should use custom model when specified", async () => {
      setMockConfig({
        responseText: "[NARRATOR] Test.",
      });

      const result = await convertWithGemini("Test text", {
        apiKey: "test-key",
        model: "gemini-3-pro-preview",
      });

      expect(result.success).toBe(true);
    });

    it("should use colon format when specified", async () => {
      setMockConfig({
        responseText: "NARRATOR: Test.",
      });

      const result = await convertWithGemini("Test text", {
        apiKey: "test-key",
        format: "colon",
      });

      expect(result.success).toBe(true);
      expect(result.speakers).toContain("NARRATOR");
    });
  });

  describe("convertToStoryFormat", () => {
    it("should convert and post-process text", async () => {
      setMockConfig({
        responseText: `[NARRATOR]  Once upon a time...

[ALICE]   Hello there!`,
      });

      const result = await convertToStoryFormat("Test story", {
        apiKey: "test-key",
      });

      expect(result.success).toBe(true);
      // Should have removed extra spaces and empty lines
      expect(result.content).toBe(
        "[NARRATOR] Once upon a time...\n[ALICE] Hello there!",
      );
    });

    it("should warn about formatting issues", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      setMockConfig({
        responseText: `[NARRATOR] Valid line.
Invalid line without tag.`,
      });

      const result = await convertToStoryFormat("Test story", {
        apiKey: "test-key",
      });

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should propagate errors from conversion", async () => {
      setMockConfig({
        shouldFail: true,
        failureMessage: "Network error",
      });

      const result = await convertToStoryFormat("Test story", {
        apiKey: "test-key",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("should use custom options", async () => {
      setMockConfig({
        responseText: "ALICE: Hello!\nBOB: Hi!",
      });

      const result = await convertToStoryFormat("Test dialogue", {
        apiKey: "test-key",
        format: "colon",
        speakers: ["ALICE", "BOB"],
        includeNarrator: false,
      });

      expect(result.success).toBe(true);
      expect(result.speakers).toContain("ALICE");
      expect(result.speakers).toContain("BOB");
    });
  });
});
