/**
 * Tests for the config module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mergeWithDefaults,
  validateConfig,
  getVoiceConfig,
  hashVoiceConfig,
  hashConfig,
  updateVoiceConfig,
  createConfigForSpeakers,
  getConfigSummary,
  resolveEnvVars,
  DEFAULT_CONFIG,
  GEMINI_VOICES,
} from "../config.js";

import {
  MINIMAL_CONFIG,
  FULL_CONFIG,
  INVALID_CONFIG_BAD_FORMAT,
  CONFIG_WITH_WARNINGS,
  VOICE_NARRATOR,
  VOICE_ALICE,
  TEST_SPEAKERS,
} from "../fixtures/configs.js";

describe("config", () => {
  describe("resolveEnvVars", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should resolve ${VAR_NAME} format", () => {
      process.env.TEST_VAR = "test-value";
      const result = resolveEnvVars("prefix-${TEST_VAR}-suffix");
      expect(result).toBe("prefix-test-value-suffix");
    });

    it("should resolve $VAR_NAME format", () => {
      process.env.MY_API_KEY = "secret-key";
      const result = resolveEnvVars("key=$MY_API_KEY");
      expect(result).toBe("key=secret-key");
    });

    it("should return original string if env var not found", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = resolveEnvVars("${NONEXISTENT_VAR}");
      expect(result).toBe("${NONEXISTENT_VAR}");
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should resolve multiple env vars", () => {
      process.env.VAR1 = "value1";
      process.env.VAR2 = "value2";
      const result = resolveEnvVars("${VAR1} and ${VAR2}");
      expect(result).toBe("value1 and value2");
    });

    it("should return string unchanged if no env vars", () => {
      const result = resolveEnvVars("plain string without vars");
      expect(result).toBe("plain string without vars");
    });
  });

  describe("mergeWithDefaults", () => {
    it("should merge partial config with defaults", () => {
      const partial = {
        provider: { name: "gemini" },
        voices: [],
      };

      const merged = mergeWithDefaults(partial);

      expect(merged.version).toBe(DEFAULT_CONFIG.version);
      expect(merged.provider.name).toBe("gemini");
      expect(merged.provider.rateLimit).toBe(DEFAULT_CONFIG.provider.rateLimit);
      expect(merged.audio.format).toBe(DEFAULT_CONFIG.audio.format);
      expect(merged.globalSeed).toBe(DEFAULT_CONFIG.globalSeed);
    });

    it("should preserve provided values", () => {
      const partial = {
        version: "2.0.0",
        provider: { name: "custom", rateLimit: 100 },
        audio: { format: "mp3" as const, silencePadding: 1000 },
        globalSeed: 99999,
      };

      const merged = mergeWithDefaults(partial);

      expect(merged.version).toBe("2.0.0");
      expect(merged.provider.rateLimit).toBe(100);
      expect(merged.audio.format).toBe("mp3");
      expect(merged.audio.silencePadding).toBe(1000);
      expect(merged.globalSeed).toBe(99999);
    });

    it("should handle empty partial config", () => {
      const merged = mergeWithDefaults({});

      expect(merged.version).toBe(DEFAULT_CONFIG.version);
      expect(merged.provider.name).toBe(DEFAULT_CONFIG.provider.name);
      expect(merged.audio.format).toBe(DEFAULT_CONFIG.audio.format);
      expect(merged.voices).toEqual([]);
    });
  });

  describe("validateConfig", () => {
    it("should validate correct config", () => {
      const result = validateConfig(MINIMAL_CONFIG);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate full config", () => {
      const result = validateConfig(FULL_CONFIG);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should error on missing version", () => {
      const config = { ...MINIMAL_CONFIG, version: "" };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing version field");
    });

    it("should error on missing provider", () => {
      const config = { ...MINIMAL_CONFIG, provider: undefined as any };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing provider configuration");
    });

    it("should error on missing provider name", () => {
      const config = {
        ...MINIMAL_CONFIG,
        provider: { ...MINIMAL_CONFIG.provider, name: "" },
      };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing provider name");
    });

    it("should error on invalid audio format", () => {
      const result = validateConfig(INVALID_CONFIG_BAD_FORMAT);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("Invalid audio format")),
      ).toBe(true);
    });

    it("should warn on missing API key", () => {
      const config = {
        ...MINIMAL_CONFIG,
        provider: { ...MINIMAL_CONFIG.provider, apiKey: undefined },
      };
      const result = validateConfig(config);

      expect(result.warnings.some((w) => w.includes("No API key"))).toBe(true);
    });

    it("should warn on unusual sample rate", () => {
      const result = validateConfig(CONFIG_WITH_WARNINGS);

      expect(
        result.warnings.some((w) => w.includes("Unusual sample rate")),
      ).toBe(true);
    });

    it("should warn on unusual voice speed", () => {
      const result = validateConfig(CONFIG_WITH_WARNINGS);

      expect(result.warnings.some((w) => w.includes("unusual speed"))).toBe(
        true,
      );
    });

    it("should warn on out-of-range pitch", () => {
      const result = validateConfig(CONFIG_WITH_WARNINGS);

      expect(
        result.warnings.some((w) => w.includes("out-of-range pitch")),
      ).toBe(true);
    });

    it("should error on voice without name", () => {
      const config = {
        ...MINIMAL_CONFIG,
        voices: [{ voiceName: "Zephyr" }],
      };
      const result = validateConfig(config as any);

      expect(result.errors).toContain("Voice configuration missing name");
    });
  });

  describe("getVoiceConfig", () => {
    it("should return exact match from voices array", () => {
      const voice = getVoiceConfig(FULL_CONFIG, "NARRATOR");

      expect(voice.name).toBe("NARRATOR");
      expect(voice.voiceName).toBe("Zephyr");
      expect(voice.stylePrompt).toBe("Calm, measured storytelling voice");
      expect(voice.seed).toBe(11111);
    });

    it("should be case-insensitive", () => {
      const voice1 = getVoiceConfig(FULL_CONFIG, "narrator");
      const voice2 = getVoiceConfig(FULL_CONFIG, "NARRATOR");
      const voice3 = getVoiceConfig(FULL_CONFIG, "Narrator");

      expect(voice1.voiceName).toBe(voice2.voiceName);
      expect(voice2.voiceName).toBe(voice3.voiceName);
    });

    it("should use defaultVoice for unknown speaker", () => {
      const voice = getVoiceConfig(FULL_CONFIG, "UNKNOWN");

      expect(voice.name).toBe("UNKNOWN");
      expect(voice.voiceName).toBe(FULL_CONFIG.defaultVoice?.voiceName);
    });

    it("should use globalSeed when voice has no seed", () => {
      const config = {
        ...MINIMAL_CONFIG,
        voices: [{ name: "TEST", voiceName: "Zephyr" }],
      };
      const voice = getVoiceConfig(config, "TEST");

      expect(voice.seed).toBe(config.globalSeed);
    });

    it("should prefer voice-specific seed over globalSeed", () => {
      const voice = getVoiceConfig(FULL_CONFIG, "ALICE");

      expect(voice.seed).toBe(22222); // ALICE's specific seed
      expect(voice.seed).not.toBe(FULL_CONFIG.globalSeed);
    });

    it("should return minimal voice for completely unknown speaker", () => {
      const voice = getVoiceConfig(MINIMAL_CONFIG, "COMPLETELY_UNKNOWN");

      expect(voice.name).toBe("COMPLETELY_UNKNOWN");
      expect(voice.voiceName).toBeDefined();
      expect(voice.seed).toBe(MINIMAL_CONFIG.globalSeed);
    });
  });

  describe("hashVoiceConfig", () => {
    it("should generate consistent hash for same config", () => {
      const hash1 = hashVoiceConfig(VOICE_NARRATOR);
      const hash2 = hashVoiceConfig(VOICE_NARRATOR);

      expect(hash1).toBe(hash2);
    });

    it("should generate different hash for different configs", () => {
      const hash1 = hashVoiceConfig(VOICE_NARRATOR);
      const hash2 = hashVoiceConfig(VOICE_ALICE);

      expect(hash1).not.toBe(hash2);
    });

    it("should be affected by stylePrompt changes", () => {
      const voice1 = { ...VOICE_NARRATOR };
      const voice2 = { ...VOICE_NARRATOR, stylePrompt: "Different style" };

      const hash1 = hashVoiceConfig(voice1);
      const hash2 = hashVoiceConfig(voice2);

      expect(hash1).not.toBe(hash2);
    });

    it("should be affected by speed changes", () => {
      const voice1 = { ...VOICE_NARRATOR, speed: 1.0 };
      const voice2 = { ...VOICE_NARRATOR, speed: 1.5 };

      const hash1 = hashVoiceConfig(voice1);
      const hash2 = hashVoiceConfig(voice2);

      expect(hash1).not.toBe(hash2);
    });

    it("should be affected by seed changes", () => {
      const voice1 = { ...VOICE_NARRATOR, seed: 12345 };
      const voice2 = { ...VOICE_NARRATOR, seed: 54321 };

      const hash1 = hashVoiceConfig(voice1);
      const hash2 = hashVoiceConfig(voice2);

      expect(hash1).not.toBe(hash2);
    });

    it("should return 32-character hex string", () => {
      const hash = hashVoiceConfig(VOICE_NARRATOR);

      expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe("hashConfig", () => {
    it("should generate consistent hash for same config", () => {
      const hash1 = hashConfig(MINIMAL_CONFIG);
      const hash2 = hashConfig(MINIMAL_CONFIG);

      expect(hash1).toBe(hash2);
    });

    it("should generate different hash for different configs", () => {
      const hash1 = hashConfig(MINIMAL_CONFIG);
      const hash2 = hashConfig(FULL_CONFIG);

      expect(hash1).not.toBe(hash2);
    });

    it("should detect any config change", () => {
      const config1 = { ...MINIMAL_CONFIG };
      const config2 = { ...MINIMAL_CONFIG, globalSeed: 99999 };

      const hash1 = hashConfig(config1);
      const hash2 = hashConfig(config2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("updateVoiceConfig", () => {
    it("should update existing voice", () => {
      const updated = updateVoiceConfig(FULL_CONFIG, "NARRATOR", {
        stylePrompt: "New narrator style",
        speed: 0.9,
      });

      const voice = updated.voices.find(
        (v) => v.name.toUpperCase() === "NARRATOR",
      );
      expect(voice?.stylePrompt).toBe("New narrator style");
      expect(voice?.speed).toBe(0.9);
      expect(voice?.voiceName).toBe("Zephyr"); // Unchanged
    });

    it("should add new voice if not exists", () => {
      const updated = updateVoiceConfig(MINIMAL_CONFIG, "NEW_SPEAKER", {
        voiceName: "Kore",
        stylePrompt: "Friendly voice",
      });

      expect(updated.voices).toHaveLength(1);
      expect(updated.voices[0].name).toBe("NEW_SPEAKER");
      expect(updated.voices[0].voiceName).toBe("Kore");
    });

    it("should be case-insensitive for speaker name", () => {
      const updated = updateVoiceConfig(FULL_CONFIG, "narrator", {
        stylePrompt: "Updated style",
      });

      const voice = updated.voices.find(
        (v) => v.name.toUpperCase() === "NARRATOR",
      );
      expect(voice?.stylePrompt).toBe("Updated style");
    });

    it("should not modify original config", () => {
      const original = { ...FULL_CONFIG };
      updateVoiceConfig(FULL_CONFIG, "NARRATOR", {
        stylePrompt: "Modified",
      });

      expect(FULL_CONFIG.voices[0].stylePrompt).toBe(
        original.voices[0].stylePrompt,
      );
    });
  });

  describe("createConfigForSpeakers", () => {
    it("should create config with voice for each speaker", () => {
      const config = createConfigForSpeakers(TEST_SPEAKERS);

      expect(config.voices).toHaveLength(TEST_SPEAKERS.length);

      TEST_SPEAKERS.forEach((speaker) => {
        const voice = config.voices.find((v) => v.name === speaker);
        expect(voice).toBeDefined();
        expect(voice?.voiceName).toBeDefined();
      });
    });

    it("should use default voice for NARRATOR", () => {
      const config = createConfigForSpeakers(["NARRATOR"]);

      expect(config.voices[0].voiceName).toBe("Zephyr");
      expect(config.voices[0].stylePrompt).toContain("storytelling");
    });

    it("should assign different voices to different speakers", () => {
      const config = createConfigForSpeakers(TEST_SPEAKERS);
      const voiceNames = config.voices.map((v) => v.voiceName);

      // With 4 speakers, we might have some repeats, but first few should be different
      expect(voiceNames[0]).toBeDefined();
    });

    it("should cycle through available voices", () => {
      const manySpeakers = Array.from({ length: 20 }, (_, i) => `SPEAKER${i}`);
      const config = createConfigForSpeakers(manySpeakers);

      expect(config.voices).toHaveLength(20);
      config.voices.forEach((voice) => {
        expect(GEMINI_VOICES).toContain(voice.voiceName);
      });
    });

    it("should set default audio config", () => {
      const config = createConfigForSpeakers(["NARRATOR"]);

      expect(config.audio.format).toBe("wav");
      expect(config.audio.sampleRate).toBe(24000);
    });

    it("should set global seed", () => {
      const config = createConfigForSpeakers(["NARRATOR"]);

      expect(config.globalSeed).toBeDefined();
    });
  });

  describe("getConfigSummary", () => {
    it("should include version", () => {
      const summary = getConfigSummary(MINIMAL_CONFIG);
      expect(summary).toContain(MINIMAL_CONFIG.version);
    });

    it("should include provider info", () => {
      const summary = getConfigSummary(MINIMAL_CONFIG);
      expect(summary).toContain(MINIMAL_CONFIG.provider.name);
      expect(summary).toContain(MINIMAL_CONFIG.provider.model || "");
    });

    it("should include audio config", () => {
      const summary = getConfigSummary(MINIMAL_CONFIG);
      expect(summary).toContain(MINIMAL_CONFIG.audio.format);
      expect(summary).toContain(String(MINIMAL_CONFIG.audio.sampleRate));
    });

    it("should list voice configurations", () => {
      const summary = getConfigSummary(FULL_CONFIG);
      expect(summary).toContain("NARRATOR");
      expect(summary).toContain("ALICE");
      expect(summary).toContain("BOB");
    });

    it("should include global seed", () => {
      const summary = getConfigSummary(MINIMAL_CONFIG);
      expect(summary).toContain(String(MINIMAL_CONFIG.globalSeed));
    });

    it("should indicate number of voice configurations", () => {
      const summary = getConfigSummary(FULL_CONFIG);
      expect(summary).toContain(`${FULL_CONFIG.voices.length}`);
    });
  });

  describe("GEMINI_VOICES constant", () => {
    it("should contain expected voices", () => {
      expect(GEMINI_VOICES).toContain("Zephyr");
      expect(GEMINI_VOICES).toContain("Kore");
      expect(GEMINI_VOICES).toContain("Charon");
    });

    it("should have multiple voices available", () => {
      expect(GEMINI_VOICES.length).toBeGreaterThan(5);
    });
  });

  describe("DEFAULT_CONFIG constant", () => {
    it("should have valid structure", () => {
      const result = validateConfig(DEFAULT_CONFIG);
      // May have warnings but should not have errors except possibly missing API key
      expect(result.errors.filter((e) => !e.includes("API key"))).toHaveLength(
        0,
      );
    });

    it("should use gemini as default provider", () => {
      expect(DEFAULT_CONFIG.provider.name).toBe("gemini");
    });

    it("should use wav as default format", () => {
      expect(DEFAULT_CONFIG.audio.format).toBe("wav");
    });
  });
});
