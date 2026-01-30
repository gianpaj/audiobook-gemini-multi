/**
 * Configuration management module for the audiobook generation system
 *
 * Handles loading, saving, and validating configuration files
 */

import { readFile, writeFile, access } from "fs/promises";

import { createHash } from "crypto";
import type { Config, VoiceConfig } from "./types.js";

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Config = {
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
  voices: [],
  globalSeed: 12345,
};

/**
 * Default voice configurations for common speaker types
 */
export const DEFAULT_VOICES: Record<string, Partial<VoiceConfig>> = {
  NARRATOR: {
    voiceName: "Zephyr",
    stylePrompt: "Calm, measured storytelling voice with clear enunciation",
    speed: 1.0,
  },
  CHARACTER1: {
    voiceName: "Kore",
    stylePrompt: "Warm, friendly voice",
    speed: 1.0,
  },
  CHARACTER2: {
    voiceName: "Charon",
    stylePrompt: "Deep, authoritative voice",
    speed: 1.0,
  },
};

/**
 * Available Gemini voices
 */
export const GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algenib",
] as const;

export type GeminiVoice = (typeof GEMINI_VOICES)[number];

/**
 * Resolve environment variable references in a string
 * Supports format: ${VAR_NAME} or $VAR_NAME
 */
export function resolveEnvVars(value: string): string {
  // Match ${VAR_NAME} or $VAR_NAME
  return value.replace(
    /\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/gi,
    (match, p1, p2) => {
      const varName = p1 || p2;
      const envValue = process.env[varName];
      if (envValue === undefined) {
        console.warn(`Warning: Environment variable ${varName} is not set`);
        return match; // Return original if not found
      }
      return envValue;
    },
  );
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load configuration from a file
 */
export async function loadConfig(configPath: string): Promise<Config> {
  const exists = await fileExists(configPath);
  if (!exists) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const content = await readFile(configPath, "utf-8");
  let config: Config;

  try {
    config = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to parse configuration file: ${configPath}\n${error instanceof Error ? error.message : error}`,
    );
  }

  // Merge with defaults
  config = mergeWithDefaults(config);

  // Validate
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration:\n${validation.errors.join("\n")}`);
  }

  return config;
}

/**
 * Load configuration or create default if not exists
 */
export async function loadOrCreateConfig(configPath: string): Promise<Config> {
  const exists = await fileExists(configPath);
  if (!exists) {
    const config = { ...DEFAULT_CONFIG };
    await saveConfig(configPath, config);
    return config;
  }
  return loadConfig(configPath);
}

/**
 * Save configuration to a file
 */
export async function saveConfig(
  configPath: string,
  config: Config,
): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await writeFile(configPath, content, "utf-8");
}

/**
 * Merge configuration with defaults
 */
export function mergeWithDefaults(config: Partial<Config>): Config {
  return {
    version: config.version || DEFAULT_CONFIG.version,
    provider: {
      ...DEFAULT_CONFIG.provider,
      ...config.provider,
    },
    audio: {
      ...DEFAULT_CONFIG.audio,
      ...config.audio,
    },
    voices: config.voices || [],
    defaultVoice: config.defaultVoice,
    globalSeed: config.globalSeed ?? DEFAULT_CONFIG.globalSeed,
  };
}

/**
 * Validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check version
  if (!config.version) {
    errors.push("Missing version field");
  }

  // Check provider
  if (!config.provider) {
    errors.push("Missing provider configuration");
  } else {
    if (!config.provider.name) {
      errors.push("Missing provider name");
    }
    if (!config.provider.apiKey) {
      warnings.push("No API key configured (may be set via environment)");
    }
  }

  // Check audio config
  if (!config.audio) {
    errors.push("Missing audio configuration");
  } else {
    if (!["mp3", "wav", "ogg", "flac"].includes(config.audio.format)) {
      errors.push(`Invalid audio format: ${config.audio.format}`);
    }
    if (
      config.audio.sampleRate &&
      (config.audio.sampleRate < 8000 || config.audio.sampleRate > 48000)
    ) {
      warnings.push(`Unusual sample rate: ${config.audio.sampleRate}Hz`);
    }
  }

  // Validate voice configs
  for (const voice of config.voices || []) {
    if (!voice.name) {
      errors.push("Voice configuration missing name");
    }
    if (
      voice.speed !== undefined &&
      (voice.speed < 0.25 || voice.speed > 4.0)
    ) {
      warnings.push(`Voice ${voice.name} has unusual speed: ${voice.speed}`);
    }
    if (
      voice.pitch !== undefined &&
      (voice.pitch < -1.0 || voice.pitch > 1.0)
    ) {
      warnings.push(
        `Voice ${voice.name} has out-of-range pitch: ${voice.pitch}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get voice configuration for a speaker
 */
export function getVoiceConfig(config: Config, speaker: string): VoiceConfig {
  const normalizedSpeaker = speaker.toUpperCase();

  // Look for exact match in configured voices
  const exactMatch = config.voices.find(
    (v) => v.name.toUpperCase() === normalizedSpeaker,
  );
  if (exactMatch) {
    return {
      ...exactMatch,
      seed: exactMatch.seed ?? config.globalSeed,
    };
  }

  // Use default voice if configured
  if (config.defaultVoice) {
    return {
      ...config.defaultVoice,
      name: speaker,
      seed: config.defaultVoice.seed ?? config.globalSeed,
    };
  }

  // Fall back to built-in defaults
  const builtinDefault = DEFAULT_VOICES[normalizedSpeaker];
  if (builtinDefault) {
    return {
      name: speaker,
      seed: config.globalSeed,
      ...builtinDefault,
    };
  }

  // Last resort: return minimal voice config
  return {
    name: speaker,
    seed: config.globalSeed,
    voiceName: GEMINI_VOICES[0],
    stylePrompt: "Natural speaking voice",
    speed: 1.0,
  };
}

/**
 * Generate a hash of the voice configuration (for cache invalidation)
 */
export function hashVoiceConfig(voice: VoiceConfig): string {
  const relevantFields = {
    name: voice.name,
    seed: voice.seed,
    stylePrompt: voice.stylePrompt,
    voiceName: voice.voiceName,
    speed: voice.speed,
    pitch: voice.pitch,
    extraParams: voice.extraParams,
  };
  return createHash("md5").update(JSON.stringify(relevantFields)).digest("hex");
}

/**
 * Generate a hash of the entire config (for cache invalidation)
 */
export function hashConfig(config: Config): string {
  return createHash("md5").update(JSON.stringify(config)).digest("hex");
}

/**
 * Update voice configuration for a specific speaker
 */
export function updateVoiceConfig(
  config: Config,
  speaker: string,
  updates: Partial<VoiceConfig>,
): Config {
  const normalizedSpeaker = speaker.toUpperCase();
  const existingIndex = config.voices.findIndex(
    (v) => v.name.toUpperCase() === normalizedSpeaker,
  );

  const newVoices = [...config.voices];

  if (existingIndex >= 0) {
    newVoices[existingIndex] = {
      ...newVoices[existingIndex],
      ...updates,
    };
  } else {
    newVoices.push({
      name: speaker,
      ...updates,
    });
  }

  return {
    ...config,
    voices: newVoices,
  };
}

/**
 * Create a configuration for discovered speakers
 */
export function createConfigForSpeakers(speakers: string[]): Config {
  const voices: VoiceConfig[] = speakers.map((speaker, index) => {
    const defaultVoice = DEFAULT_VOICES[speaker.toUpperCase()];
    return {
      name: speaker,
      voiceName:
        defaultVoice?.voiceName || GEMINI_VOICES[index % GEMINI_VOICES.length],
      stylePrompt: defaultVoice?.stylePrompt || `Voice for ${speaker}`,
      speed: defaultVoice?.speed || 1.0,
    };
  });

  return {
    ...DEFAULT_CONFIG,
    voices,
  };
}

/**
 * Get resolved API key (with env var substitution)
 */
export function getApiKey(config: Config): string | undefined {
  if (!config.provider.apiKey) {
    return process.env.GEMINI_API_KEY;
  }
  return resolveEnvVars(config.provider.apiKey);
}

/**
 * Print configuration summary
 */
export function getConfigSummary(config: Config): string {
  const lines: string[] = [];

  lines.push(`Configuration v${config.version}`);
  lines.push(
    `Provider: ${config.provider.name} (model: ${config.provider.model})`,
  );
  lines.push(
    `Audio: ${config.audio.format}, ${config.audio.sampleRate}Hz, ${config.audio.silencePadding}ms padding`,
  );
  lines.push(`Global seed: ${config.globalSeed}`);
  lines.push(`\nVoice configurations (${config.voices.length}):`);

  for (const voice of config.voices) {
    lines.push(`  ${voice.name}:`);
    lines.push(`    Voice: ${voice.voiceName || "default"}`);
    if (voice.stylePrompt) {
      lines.push(`    Style: "${voice.stylePrompt}"`);
    }
    if (voice.speed !== undefined && voice.speed !== 1.0) {
      lines.push(`    Speed: ${voice.speed}x`);
    }
    if (voice.seed !== undefined) {
      lines.push(`    Seed: ${voice.seed}`);
    }
  }

  if (config.defaultVoice) {
    lines.push(`\nDefault voice: ${config.defaultVoice.voiceName || "auto"}`);
  }

  return lines.join("\n");
}

/**
 * Export configuration as a template with comments
 */
export function exportConfigTemplate(
  speakers: string[] = ["NARRATOR", "CHARACTER1", "CHARACTER2"],
): string {
  const config = createConfigForSpeakers(speakers);

  const template = {
    _comment: "Audiobook Generator Configuration",
    _docs: "See README.md for full documentation of all options",
    ...config,
  };

  return JSON.stringify(template, null, 2);
}
