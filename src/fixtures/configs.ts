/**
 * Test fixtures for configuration objects
 */

import type { Config, VoiceConfig, ProviderConfig, AudioConfig } from "../types.js";

/**
 * Valid minimal configuration
 */
export const MINIMAL_CONFIG: Config = {
  version: "1.0.0",
  provider: {
    name: "gemini",
    apiKey: "test-api-key",
    model: "gemini-2.5-pro-preview-tts",
    rateLimit: 60,
    maxRetries: 3,
    timeout: 60000,
  },
  audio: {
    format: "wav",
    sampleRate: 24000,
    bitDepth: 16,
    silencePadding: 500,
    normalize: false,
  },
  voices: [],
  globalSeed: 12345,
};

/**
 * Full configuration with multiple voices
 */
export const FULL_CONFIG: Config = {
  version: "1.0.0",
  provider: {
    name: "gemini",
    apiKey: "${GEMINI_API_KEY}",
    model: "gemini-2.5-pro-preview-tts",
    rateLimit: 60,
    maxRetries: 3,
    timeout: 60000,
  },
  audio: {
    format: "wav",
    sampleRate: 24000,
    bitDepth: 16,
    silencePadding: 500,
    normalize: false,
  },
  voices: [
    {
      name: "NARRATOR",
      voiceName: "Zephyr",
      stylePrompt: "Calm, measured storytelling voice",
      speed: 1.0,
      seed: 11111,
    },
    {
      name: "ALICE",
      voiceName: "Kore",
      stylePrompt: "Young, energetic woman",
      speed: 1.1,
      seed: 22222,
    },
    {
      name: "BOB",
      voiceName: "Charon",
      stylePrompt: "Deep, friendly male voice",
      speed: 0.95,
      seed: 33333,
    },
  ],
  defaultVoice: {
    name: "DEFAULT",
    voiceName: "Zephyr",
    stylePrompt: "Natural speaking voice",
    speed: 1.0,
  },
  globalSeed: 12345,
};

/**
 * Configuration with environment variable reference
 */
export const CONFIG_WITH_ENV_VAR: Config = {
  ...MINIMAL_CONFIG,
  provider: {
    ...MINIMAL_CONFIG.provider,
    apiKey: "${GEMINI_API_KEY}",
  },
};

/**
 * Invalid configuration - missing version
 */
export const INVALID_CONFIG_NO_VERSION = {
  provider: {
    name: "gemini",
    apiKey: "test-key",
  },
  audio: {
    format: "wav",
  },
  voices: [],
};

/**
 * Invalid configuration - missing provider
 */
export const INVALID_CONFIG_NO_PROVIDER = {
  version: "1.0.0",
  audio: {
    format: "wav",
  },
  voices: [],
};

/**
 * Invalid configuration - invalid audio format
 */
export const INVALID_CONFIG_BAD_FORMAT: Config = {
  ...MINIMAL_CONFIG,
  audio: {
    ...MINIMAL_CONFIG.audio,
    format: "invalid" as "wav",
  },
};

/**
 * Configuration with unusual values (should generate warnings)
 */
export const CONFIG_WITH_WARNINGS: Config = {
  ...MINIMAL_CONFIG,
  audio: {
    ...MINIMAL_CONFIG.audio,
    sampleRate: 4000, // Unusual sample rate
  },
  voices: [
    {
      name: "NARRATOR",
      voiceName: "Zephyr",
      speed: 5.0, // Unusual speed
      pitch: 2.0, // Out of range pitch
    },
  ],
};

/**
 * Voice configuration samples
 */
export const VOICE_NARRATOR: VoiceConfig = {
  name: "NARRATOR",
  voiceName: "Zephyr",
  stylePrompt: "Calm, measured storytelling voice with clear enunciation",
  speed: 1.0,
  seed: 12345,
};

export const VOICE_ALICE: VoiceConfig = {
  name: "ALICE",
  voiceName: "Kore",
  stylePrompt: "Young, curious, and enthusiastic",
  speed: 1.1,
  pitch: 0.2,
  seed: 54321,
};

export const VOICE_BOB: VoiceConfig = {
  name: "BOB",
  voiceName: "Charon",
  stylePrompt: "Deep, friendly, supportive",
  speed: 0.9,
  pitch: -0.3,
  seed: 98765,
};

/**
 * Voice with minimal configuration
 */
export const VOICE_MINIMAL: VoiceConfig = {
  name: "MINIMAL",
};

/**
 * Voice with all optional fields
 */
export const VOICE_FULL: VoiceConfig = {
  name: "FULL",
  voiceName: "Aoede",
  stylePrompt: "Musical and expressive",
  speed: 1.2,
  pitch: 0.5,
  seed: 11111,
  extraParams: {
    customParam1: "value1",
    customParam2: 42,
  },
};

/**
 * Provider configuration samples
 */
export const PROVIDER_GEMINI: ProviderConfig = {
  name: "gemini",
  apiKey: "test-api-key",
  model: "gemini-2.5-pro-preview-tts",
  rateLimit: 60,
  maxRetries: 3,
  timeout: 60000,
};

export const PROVIDER_MINIMAL: ProviderConfig = {
  name: "gemini",
};

/**
 * Audio configuration samples
 */
export const AUDIO_WAV: AudioConfig = {
  format: "wav",
  sampleRate: 24000,
  bitDepth: 16,
  silencePadding: 500,
  normalize: false,
};

export const AUDIO_MP3: AudioConfig = {
  format: "mp3",
  sampleRate: 44100,
  silencePadding: 300,
  normalize: true,
};

/**
 * Configuration JSON string (for testing file loading)
 */
export const CONFIG_JSON_STRING = JSON.stringify(MINIMAL_CONFIG, null, 2);

/**
 * Invalid JSON string
 */
export const INVALID_JSON_STRING = "{ invalid json }";

/**
 * Speakers list for testing createConfigForSpeakers
 */
export const TEST_SPEAKERS = ["NARRATOR", "ALICE", "BOB", "VILLAIN"];
