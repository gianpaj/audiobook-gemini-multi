/**
 * Tests for the voices module
 *
 * Tests voice data, filtering, and suggestion functions
 */

import { describe, it, expect } from "vitest";
import {
  GEMINI_VOICES_DATA,
  getVoicesByGender,
  getFemaleVoices,
  getMaleVoices,
  getNeutralVoices,
  getVoiceByName,
  suggestVoiceForCharacter,
  suggestVoicesForAnalysis,
  formatVoiceSuggestions,
  suggestionsToVoiceConfigs,
  formatVoiceSuggestionsAsConfig,
  type VoiceSuggestion,
} from "../voices.js";
import type { Character, AnalysisResult } from "../analyzer.js";

describe("voices", () => {
  describe("GEMINI_VOICES_DATA", () => {
    it("should have all 30 voices", () => {
      expect(GEMINI_VOICES_DATA).toHaveLength(30);
    });

    it("should have required properties for each voice", () => {
      for (const voice of GEMINI_VOICES_DATA) {
        expect(voice).toHaveProperty("name");
        expect(voice).toHaveProperty("style");
        expect(voice).toHaveProperty("pitch");
        expect(voice).toHaveProperty("gender");
        expect(typeof voice.name).toBe("string");
        expect(typeof voice.style).toBe("string");
        expect(["Higher", "Middle", "Lower", "Lower middle"]).toContain(
          voice.pitch,
        );
        expect(["Female", "Male", "Neutral"]).toContain(voice.gender);
      }
    });

    it("should have unique voice names", () => {
      const names = GEMINI_VOICES_DATA.map((v) => v.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("should have a mix of genders", () => {
      const female = GEMINI_VOICES_DATA.filter((v) => v.gender === "Female");
      const male = GEMINI_VOICES_DATA.filter((v) => v.gender === "Male");
      const neutral = GEMINI_VOICES_DATA.filter((v) => v.gender === "Neutral");

      expect(female.length).toBeGreaterThan(0);
      expect(male.length).toBeGreaterThan(0);
      expect(neutral.length).toBeGreaterThan(0);
    });
  });

  describe("getVoicesByGender", () => {
    it("should return only female voices when filtering by Female", () => {
      const voices = getVoicesByGender("Female");
      expect(voices.length).toBeGreaterThan(0);
      for (const voice of voices) {
        expect(voice.gender).toBe("Female");
      }
    });

    it("should return only male voices when filtering by Male", () => {
      const voices = getVoicesByGender("Male");
      expect(voices.length).toBeGreaterThan(0);
      for (const voice of voices) {
        expect(voice.gender).toBe("Male");
      }
    });

    it("should return only neutral voices when filtering by Neutral", () => {
      const voices = getVoicesByGender("Neutral");
      expect(voices.length).toBeGreaterThan(0);
      for (const voice of voices) {
        expect(voice.gender).toBe("Neutral");
      }
    });
  });

  describe("getFemaleVoices", () => {
    it("should return all female voices", () => {
      const voices = getFemaleVoices();
      expect(voices.length).toBeGreaterThan(0);
      expect(voices.every((v) => v.gender === "Female")).toBe(true);
    });

    it("should include known female voices", () => {
      const voices = getFemaleVoices();
      const names = voices.map((v) => v.name);
      expect(names).toContain("Zephyr");
      expect(names).toContain("Kore");
      expect(names).toContain("Leda");
    });
  });

  describe("getMaleVoices", () => {
    it("should return all male voices", () => {
      const voices = getMaleVoices();
      expect(voices.length).toBeGreaterThan(0);
      expect(voices.every((v) => v.gender === "Male")).toBe(true);
    });

    it("should include known male voices", () => {
      const voices = getMaleVoices();
      const names = voices.map((v) => v.name);
      expect(names).toContain("Puck");
      expect(names).toContain("Charon");
      expect(names).toContain("Fenrir");
    });
  });

  describe("getNeutralVoices", () => {
    it("should return all neutral voices", () => {
      const voices = getNeutralVoices();
      expect(voices.length).toBeGreaterThan(0);
      expect(voices.every((v) => v.gender === "Neutral")).toBe(true);
    });

    it("should include known neutral voices", () => {
      const voices = getNeutralVoices();
      const names = voices.map((v) => v.name);
      expect(names).toContain("Pulcherrima");
      expect(names).toContain("Achird");
      expect(names).toContain("Vindemiatrix");
    });
  });

  describe("getVoiceByName", () => {
    it("should find voice by exact name", () => {
      const voice = getVoiceByName("Zephyr");
      expect(voice).toBeDefined();
      expect(voice?.name).toBe("Zephyr");
      expect(voice?.gender).toBe("Female");
    });

    it("should find voice case-insensitively", () => {
      const voice = getVoiceByName("zephyr");
      expect(voice).toBeDefined();
      expect(voice?.name).toBe("Zephyr");
    });

    it("should return undefined for unknown voice", () => {
      const voice = getVoiceByName("UnknownVoice");
      expect(voice).toBeUndefined();
    });
  });

  describe("suggestVoiceForCharacter", () => {
    it("should suggest female voice for female character", () => {
      const character: Character = {
        name: "ALICE",
        gender: "female",
        confidence: "high",
      };
      const suggestion = suggestVoiceForCharacter(character);
      expect(suggestion.voice.gender).toBe("Female");
      expect(suggestion.character).toBe(character);
    });

    it("should suggest male voice for male character", () => {
      const character: Character = {
        name: "BOB",
        gender: "male",
        confidence: "high",
      };
      const suggestion = suggestVoiceForCharacter(character);
      expect(suggestion.voice.gender).toBe("Male");
    });

    it("should suggest neutral voice for neutral character", () => {
      const character: Character = {
        name: "ENTITY",
        gender: "neutral",
        confidence: "high",
      };
      const suggestion = suggestVoiceForCharacter(character);
      expect(suggestion.voice.gender).toBe("Neutral");
    });

    it("should avoid used voices when possible", () => {
      const character: Character = {
        name: "ALICE",
        gender: "female",
        confidence: "high",
      };
      const usedVoices = new Set(["Zephyr"]);
      const suggestion = suggestVoiceForCharacter(character, usedVoices);
      expect(suggestion.voice.name).not.toBe("Zephyr");
    });

    it("should generate style prompt", () => {
      const character: Character = {
        name: "ALICE",
        gender: "female",
        description: "a young adventurer",
        confidence: "high",
      };
      const suggestion = suggestVoiceForCharacter(character);
      expect(suggestion.stylePrompt).toBeTruthy();
      expect(typeof suggestion.stylePrompt).toBe("string");
    });

    it("should include character description in style prompt", () => {
      const character: Character = {
        name: "ALICE",
        gender: "female",
        description: "a brave warrior",
        confidence: "high",
      };
      const suggestion = suggestVoiceForCharacter(character);
      expect(suggestion.stylePrompt).toContain("brave warrior");
    });

    it("should handle NARRATOR specially", () => {
      const character: Character = {
        name: "NARRATOR",
        gender: "neutral",
        confidence: "high",
      };
      const suggestion = suggestVoiceForCharacter(character);
      expect(suggestion.stylePrompt).toContain("narration");
    });
  });

  describe("suggestVoicesForAnalysis", () => {
    it("should return empty array for failed analysis", () => {
      const result: AnalysisResult = {
        success: false,
        error: "Analysis failed",
      };
      const suggestions = suggestVoicesForAnalysis(result);
      expect(suggestions).toEqual([]);
    });

    it("should return empty array for missing characters", () => {
      const result: AnalysisResult = {
        success: true,
      };
      const suggestions = suggestVoicesForAnalysis(result);
      expect(suggestions).toEqual([]);
    });

    it("should suggest voices for all characters", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          { name: "NARRATOR", gender: "neutral", confidence: "high" },
          { name: "ALICE", gender: "female", confidence: "high" },
          { name: "BOB", gender: "male", confidence: "high" },
        ],
      };
      const suggestions = suggestVoicesForAnalysis(result);
      expect(suggestions).toHaveLength(3);
    });

    it("should assign unique voices to each character", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          { name: "ALICE", gender: "female", confidence: "high" },
          { name: "BETH", gender: "female", confidence: "high" },
          { name: "CAROL", gender: "female", confidence: "high" },
        ],
      };
      const suggestions = suggestVoicesForAnalysis(result);
      const voiceNames = suggestions.map((s) => s.voice.name);
      expect(new Set(voiceNames).size).toBe(3);
    });

    it("should prioritize NARRATOR first", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          { name: "ALICE", gender: "female", confidence: "high" },
          { name: "NARRATOR", gender: "neutral", confidence: "high" },
          { name: "BOB", gender: "male", confidence: "high" },
        ],
      };
      const suggestions = suggestVoicesForAnalysis(result);
      // NARRATOR should be processed first internally
      const narratorSuggestion = suggestions.find(
        (s) => s.character.name === "NARRATOR",
      );
      expect(narratorSuggestion).toBeDefined();
    });

    it("should handle many characters of same gender", () => {
      const result: AnalysisResult = {
        success: true,
        characters: Array.from({ length: 15 }, (_, i) => ({
          name: `CHAR${i}`,
          gender: "female" as const,
          confidence: "high" as const,
        })),
      };
      const suggestions = suggestVoicesForAnalysis(result);
      expect(suggestions).toHaveLength(15);
      // Should still work even with more characters than voices of that gender
    });
  });

  describe("formatVoiceSuggestions", () => {
    it("should return message for empty suggestions", () => {
      const result = formatVoiceSuggestions([]);
      expect(result).toContain("No voice suggestions");
    });

    it("should format suggestions grouped by gender", () => {
      const suggestions: VoiceSuggestion[] = [
        {
          character: { name: "ALICE", gender: "female", confidence: "high" },
          voice: {
            name: "Zephyr",
            style: "Bright",
            pitch: "Higher",
            gender: "Female",
          },
          stylePrompt: "Bright voice",
        },
        {
          character: { name: "BOB", gender: "male", confidence: "high" },
          voice: {
            name: "Puck",
            style: "Upbeat",
            pitch: "Middle",
            gender: "Male",
          },
          stylePrompt: "Upbeat voice",
        },
      ];
      const result = formatVoiceSuggestions(suggestions);
      expect(result).toContain("Female Characters:");
      expect(result).toContain("Male Characters:");
      expect(result).toContain("ALICE");
      expect(result).toContain("Zephyr");
      expect(result).toContain("BOB");
      expect(result).toContain("Puck");
    });

    it("should include pitch information", () => {
      const suggestions: VoiceSuggestion[] = [
        {
          character: { name: "ALICE", gender: "female", confidence: "high" },
          voice: {
            name: "Zephyr",
            style: "Bright",
            pitch: "Higher",
            gender: "Female",
          },
          stylePrompt: "Bright voice",
        },
      ];
      const result = formatVoiceSuggestions(suggestions);
      expect(result).toContain("Higher pitch");
    });
  });

  describe("suggestionsToVoiceConfigs", () => {
    it("should convert suggestions to voice configs", () => {
      const suggestions: VoiceSuggestion[] = [
        {
          character: { name: "ALICE", gender: "female", confidence: "high" },
          voice: {
            name: "Zephyr",
            style: "Bright",
            pitch: "Higher",
            gender: "Female",
          },
          stylePrompt: "Bright, energetic voice",
        },
      ];
      const configs = suggestionsToVoiceConfigs(suggestions);
      expect(configs).toHaveLength(1);
      expect(configs[0]).toEqual({
        name: "ALICE",
        voiceName: "Zephyr",
        stylePrompt: "Bright, energetic voice",
        speed: 1.0,
      });
    });

    it("should convert multiple suggestions", () => {
      const suggestions: VoiceSuggestion[] = [
        {
          character: { name: "ALICE", gender: "female", confidence: "high" },
          voice: {
            name: "Zephyr",
            style: "Bright",
            pitch: "Higher",
            gender: "Female",
          },
          stylePrompt: "Bright voice",
        },
        {
          character: { name: "BOB", gender: "male", confidence: "high" },
          voice: {
            name: "Puck",
            style: "Upbeat",
            pitch: "Middle",
            gender: "Male",
          },
          stylePrompt: "Upbeat voice",
        },
      ];
      const configs = suggestionsToVoiceConfigs(suggestions);
      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("ALICE");
      expect(configs[1].name).toBe("BOB");
    });
  });

  describe("formatVoiceSuggestionsAsConfig", () => {
    it("should return valid JSON string", () => {
      const suggestions: VoiceSuggestion[] = [
        {
          character: { name: "ALICE", gender: "female", confidence: "high" },
          voice: {
            name: "Zephyr",
            style: "Bright",
            pitch: "Higher",
            gender: "Female",
          },
          stylePrompt: "Bright voice",
        },
      ];
      const jsonStr = formatVoiceSuggestionsAsConfig(suggestions);
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe("ALICE");
    });
  });

  describe("integration", () => {
    it("should suggest voices for a complete analysis result", () => {
      const result: AnalysisResult = {
        success: true,
        characters: [
          {
            name: "NARRATOR",
            gender: "neutral",
            description: "provides narration",
            confidence: "high",
          },
          {
            name: "RIA",
            gender: "female",
            description: "heartbroken woman",
            confidence: "high",
          },
          {
            name: "NAINA",
            gender: "female",
            description: "best friend",
            confidence: "high",
          },
          {
            name: "JOHN",
            gender: "male",
            description: "the ex-boyfriend",
            confidence: "high",
          },
        ],
      };

      const suggestions = suggestVoicesForAnalysis(result);
      expect(suggestions).toHaveLength(4);

      // All voices should be unique
      const voiceNames = suggestions.map((s) => s.voice.name);
      expect(new Set(voiceNames).size).toBe(4);

      // Genders should match
      const riaSuggestion = suggestions.find((s) => s.character.name === "RIA");
      expect(riaSuggestion?.voice.gender).toBe("Female");

      const johnSuggestion = suggestions.find(
        (s) => s.character.name === "JOHN",
      );
      expect(johnSuggestion?.voice.gender).toBe("Male");

      const narratorSuggestion = suggestions.find(
        (s) => s.character.name === "NARRATOR",
      );
      expect(narratorSuggestion?.voice.gender).toBe("Neutral");

      // Convert to config and verify
      const configs = suggestionsToVoiceConfigs(suggestions);
      expect(configs).toHaveLength(4);
      for (const config of configs) {
        expect(config).toHaveProperty("name");
        expect(config).toHaveProperty("voiceName");
        expect(config).toHaveProperty("stylePrompt");
        expect(config).toHaveProperty("speed");
        expect(config.speed).toBe(1.0);
      }
    });
  });
});
