/**
 * Voice data and suggestion module
 *
 * Contains Gemini voice data and functions to suggest appropriate voices
 * based on character analysis (gender matching).
 */

import type { Gender, Character, AnalysisResult } from "./analyzer.js";

// ============================================================================
// Types
// ============================================================================

export type VoicePitch = "Higher" | "Middle" | "Lower" | "Lower middle";
export type VoiceGender = "Female" | "Male" | "Neutral";

export interface VoiceInfo {
  /** Voice name (e.g., "Zephyr") */
  name: string;
  /** Voice style description (e.g., "Bright", "Upbeat") */
  style: string;
  /** Voice pitch level */
  pitch: VoicePitch;
  /** Voice gender */
  gender: VoiceGender;
}

export interface VoiceSuggestion {
  /** Character information */
  character: Character;
  /** Suggested voice */
  voice: VoiceInfo;
  /** Generated style prompt based on character and voice */
  stylePrompt: string;
}

// ============================================================================
// Voice Data (from gemini_voices.csv)
// ============================================================================

/**
 * Complete Gemini voice data
 * Source: gemini_voices.csv
 */
export const GEMINI_VOICES_DATA: VoiceInfo[] = [
  { name: "Zephyr", style: "Bright", pitch: "Higher", gender: "Female" },
  { name: "Puck", style: "Upbeat", pitch: "Middle", gender: "Male" },
  { name: "Charon", style: "Informative", pitch: "Lower", gender: "Male" },
  { name: "Kore", style: "Firm", pitch: "Middle", gender: "Female" },
  { name: "Fenrir", style: "Excitable", pitch: "Lower", gender: "Male" },
  { name: "Leda", style: "Youthful", pitch: "Higher", gender: "Female" },
  { name: "Orus", style: "Firm", pitch: "Lower middle", gender: "Male" },
  { name: "Aoede", style: "Breezy", pitch: "Middle", gender: "Female" },
  { name: "Callirrhoe", style: "Easy-going", pitch: "Middle", gender: "Female" },
  { name: "Autonoe", style: "Bright", pitch: "Middle", gender: "Female" },
  { name: "Enceladus", style: "Breathy", pitch: "Lower", gender: "Male" },
  { name: "Iapetus", style: "Clear", pitch: "Lower middle", gender: "Male" },
  { name: "Umbriel", style: "Easy-going", pitch: "Lower middle", gender: "Male" },
  { name: "Algieba", style: "Smooth", pitch: "Lower", gender: "Male" },
  { name: "Despina", style: "Smooth", pitch: "Middle", gender: "Female" },
  { name: "Erinome", style: "Clear", pitch: "Middle", gender: "Female" },
  { name: "Algenib", style: "Gravelly", pitch: "Lower", gender: "Male" },
  { name: "Rasalgethi", style: "Informative", pitch: "Middle", gender: "Male" },
  { name: "Laomedeia", style: "Upbeat", pitch: "Higher", gender: "Female" },
  { name: "Achernar", style: "Soft", pitch: "Higher", gender: "Female" },
  { name: "Alnilam", style: "Firm", pitch: "Lower middle", gender: "Male" },
  { name: "Schedar", style: "Even", pitch: "Lower middle", gender: "Male" },
  { name: "Gacrux", style: "Mature", pitch: "Middle", gender: "Female" },
  { name: "Pulcherrima", style: "Forward", pitch: "Middle", gender: "Neutral" },
  { name: "Achird", style: "Friendly", pitch: "Middle", gender: "Neutral" },
  { name: "Zubenelgenubi", style: "Casual", pitch: "Lower middle", gender: "Male" },
  { name: "Vindemiatrix", style: "Gentle", pitch: "Middle", gender: "Neutral" },
  { name: "Sadachbia", style: "Lively", pitch: "Lower", gender: "Male" },
  { name: "Sadaltager", style: "Knowledgeable", pitch: "Middle", gender: "Male" },
  { name: "Sulafat", style: "Warm", pitch: "Middle", gender: "Female" },
];

// ============================================================================
// Voice Filtering Functions
// ============================================================================

/**
 * Get voices filtered by gender
 */
export function getVoicesByGender(gender: VoiceGender): VoiceInfo[] {
  return GEMINI_VOICES_DATA.filter((v) => v.gender === gender);
}

/**
 * Get all female voices
 */
export function getFemaleVoices(): VoiceInfo[] {
  return getVoicesByGender("Female");
}

/**
 * Get all male voices
 */
export function getMaleVoices(): VoiceInfo[] {
  return getVoicesByGender("Male");
}

/**
 * Get all neutral voices
 */
export function getNeutralVoices(): VoiceInfo[] {
  return getVoicesByGender("Neutral");
}

/**
 * Get a voice by name
 */
export function getVoiceByName(name: string): VoiceInfo | undefined {
  return GEMINI_VOICES_DATA.find(
    (v) => v.name.toLowerCase() === name.toLowerCase()
  );
}

// ============================================================================
// Voice Suggestion Functions
// ============================================================================

/**
 * Map character gender to voice gender
 */
function mapGenderToVoiceGender(gender: Gender): VoiceGender {
  switch (gender) {
    case "female":
      return "Female";
    case "male":
      return "Male";
    case "neutral":
      return "Neutral";
  }
}

/**
 * Generate a style prompt based on character and voice
 */
function generateStylePrompt(character: Character, voice: VoiceInfo): string {
  const parts: string[] = [];

  // Add voice style
  parts.push(voice.style);

  // Add character description if available
  if (character.description) {
    // Clean up description - remove character name references
    const cleanDesc = character.description
      .replace(new RegExp(character.name, "gi"), "")
      .trim();
    if (cleanDesc && cleanDesc.length > 0) {
      parts.push(cleanDesc);
    }
  }

  // Add pitch description for variety
  if (voice.pitch === "Higher") {
    parts.push("higher-pitched voice");
  } else if (voice.pitch === "Lower") {
    parts.push("deeper voice");
  }

  // Special handling for narrator
  if (character.name === "NARRATOR") {
    return `${voice.style}, clear narration with measured pacing`;
  }

  return parts.join(", ");
}

/**
 * Suggest a voice for a single character
 * Uses round-robin selection within gender to avoid duplicates
 */
export function suggestVoiceForCharacter(
  character: Character,
  usedVoices: Set<string> = new Set()
): VoiceSuggestion {
  const voiceGender = mapGenderToVoiceGender(character.gender);
  let candidates = getVoicesByGender(voiceGender);

  // Special handling for NARRATOR - prefer informative/clear voices
  if (character.name === "NARRATOR") {
    const narratorVoices = GEMINI_VOICES_DATA.filter(
      (v) =>
        v.style === "Informative" ||
        v.style === "Clear" ||
        v.style === "Even" ||
        v.name === "Zephyr" // Classic narrator voice
    );
    if (narratorVoices.length > 0) {
      candidates = narratorVoices;
    }
  }

  // Filter out already used voices if possible
  const available = candidates.filter((v) => !usedVoices.has(v.name));

  // If all voices of this gender are used, fall back to all candidates
  const voicePool = available.length > 0 ? available : candidates;

  // Select the first available voice (deterministic)
  const voice = voicePool[0];

  return {
    character,
    voice,
    stylePrompt: generateStylePrompt(character, voice),
  };
}

/**
 * Suggest voices for all characters in an analysis result
 * Ensures no duplicate voices are assigned
 */
export function suggestVoicesForAnalysis(
  result: AnalysisResult
): VoiceSuggestion[] {
  if (!result.success || !result.characters) {
    return [];
  }

  const suggestions: VoiceSuggestion[] = [];
  const usedVoices = new Set<string>();

  // Track available voices by gender for round-robin
  const availableByGender: Record<VoiceGender, VoiceInfo[]> = {
    Female: [...getFemaleVoices()],
    Male: [...getMaleVoices()],
    Neutral: [...getNeutralVoices()],
  };

  // Process NARRATOR first if present (to give them a good narrator voice)
  const narrator = result.characters.find((c) => c.name === "NARRATOR");
  const others = result.characters.filter((c) => c.name !== "NARRATOR");
  const orderedCharacters = narrator ? [narrator, ...others] : others;

  for (const character of orderedCharacters) {
    const voiceGender = mapGenderToVoiceGender(character.gender);
    let candidates = availableByGender[voiceGender];

    // Special handling for NARRATOR
    if (character.name === "NARRATOR") {
      const narratorPreferred = candidates.filter(
        (v) =>
          v.style === "Informative" ||
          v.style === "Clear" ||
          v.style === "Even" ||
          v.name === "Zephyr"
      );
      if (narratorPreferred.length > 0) {
        candidates = narratorPreferred;
      }
    }

    // If no candidates left in this gender, try neutral, then any
    if (candidates.length === 0) {
      candidates = availableByGender["Neutral"];
    }
    if (candidates.length === 0) {
      // Fall back to any unused voice
      candidates = GEMINI_VOICES_DATA.filter((v) => !usedVoices.has(v.name));
    }
    if (candidates.length === 0) {
      // Last resort: reuse voices
      candidates = getVoicesByGender(voiceGender);
      if (candidates.length === 0) {
        candidates = GEMINI_VOICES_DATA;
      }
    }

    const voice = candidates[0];

    suggestions.push({
      character,
      voice,
      stylePrompt: generateStylePrompt(character, voice),
    });

    // Mark voice as used
    usedVoices.add(voice.name);

    // Remove from available pools
    for (const gender of Object.keys(availableByGender) as VoiceGender[]) {
      availableByGender[gender] = availableByGender[gender].filter(
        (v) => v.name !== voice.name
      );
    }
  }

  return suggestions;
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format voice suggestions for display
 */
export function formatVoiceSuggestions(suggestions: VoiceSuggestion[]): string {
  if (suggestions.length === 0) {
    return "No voice suggestions available.";
  }

  const lines: string[] = [];

  // Group by gender for display
  const female = suggestions.filter((s) => s.character.gender === "female");
  const male = suggestions.filter((s) => s.character.gender === "male");
  const neutral = suggestions.filter((s) => s.character.gender === "neutral");

  const formatSuggestion = (s: VoiceSuggestion): string => {
    return `  ${s.character.name} → ${s.voice.name} (${s.voice.style}, ${s.voice.pitch} pitch)`;
  };

  if (female.length > 0) {
    lines.push("Female Characters:");
    for (const s of female) {
      lines.push(formatSuggestion(s));
    }
    lines.push("");
  }

  if (male.length > 0) {
    lines.push("Male Characters:");
    for (const s of male) {
      lines.push(formatSuggestion(s));
    }
    lines.push("");
  }

  if (neutral.length > 0) {
    lines.push("Neutral Characters:");
    for (const s of neutral) {
      lines.push(formatSuggestion(s));
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Convert voice suggestions to VoiceConfig array for config.json
 */
export function suggestionsToVoiceConfigs(
  suggestions: VoiceSuggestion[]
): Array<{
  name: string;
  voiceName: string;
  stylePrompt: string;
  speed: number;
}> {
  return suggestions.map((s) => ({
    name: s.character.name,
    voiceName: s.voice.name,
    stylePrompt: s.stylePrompt,
    speed: 1.0,
  }));
}

/**
 * Format voice suggestions as JSON config snippet
 */
export function formatVoiceSuggestionsAsConfig(
  suggestions: VoiceSuggestion[]
): string {
  const configs = suggestionsToVoiceConfigs(suggestions);
  return JSON.stringify(configs, null, 2);
}
