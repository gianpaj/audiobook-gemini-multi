/**
 * Audiobook Generator - Main Entry Point
 *
 * A TypeScript CLI tool for generating audiobooks from story scripts
 * using Text-to-Speech APIs with multi-speaker support.
 *
 * @module audiobook-generator
 */

// Export all types
export type {
  // Parser types
  Segment,
  ParsedStory,
  // Config types
  VoiceConfig,
  ProviderConfig,
  AudioConfig,
  Config,
  // Cache types
  SegmentHash,
  CachedSegment,
  CacheManifest,
  // Generation types
  GenerationStats,
  GenerationProgress,
  SegmentGenerationResult,
  AudiobookResult,
  // Manifest types
  ManifestSegment,
  AudiobookManifest,
  // TTS types
  TTSRequest,
  TTSResponse,
  MultiSpeakerTTSRequest,
  // CLI types
  GenerateOptions,
  PreviewOptions,
  UpdateStylesOptions,
  CleanOptions,
  // Event types
  GenerationEvent,
  GenerationEventHandler,
} from "./types.js";

// Export parser functions
export {
  parseFile,
  parseContent,
  detectFormat,
  validateParsedStory,
  getStorySummary,
  extractSpeakers,
  convertFormat,
  filterBySpeaker,
  getSegmentRange,
  type ParserOptions,
  type ValidationResult,
} from "./parser.js";

// Export config functions
export {
  loadConfig,
  loadOrCreateConfig,
  saveConfig,
  mergeWithDefaults,
  validateConfig,
  getVoiceConfig,
  hashVoiceConfig,
  hashConfig,
  updateVoiceConfig,
  createConfigForSpeakers,
  getApiKey,
  getConfigSummary,
  exportConfigTemplate,
  resolveEnvVars,
  DEFAULT_CONFIG,
  DEFAULT_VOICES,
  GEMINI_VOICES,
  type GeminiVoice,
  type ConfigValidationResult,
} from "./config.js";

// Export cache functions
export {
  hashText,
  shortHash,
  generateSegmentHash,
  getCacheDir,
  getCacheManifestPath,
  getCachedSegmentPath,
  ensureCacheDir,
  createEmptyManifest,
  loadCacheManifest,
  saveCacheManifest,
  isSegmentCached,
  verifyCachedSegment,
  updateCachedSegment,
  removeCachedSegment,
  getSegmentsToGenerate,
  getCachedSegments,
  getSegmentsWithStyleChanges,
  cleanStaleCacheEntries,
  getCacheStats,
  clearCache,
  getCacheDirSize,
  formatBytes,
  getCacheSummary,
  updateManifestStats,
  invalidateSpeakerCache,
  CACHE_DIR_NAME,
  CACHE_MANIFEST_NAME,
  CACHE_VERSION,
} from "./cache.js";

// Export TTS provider functions and classes
export {
  GeminiTTSProvider,
  createTTSProvider,
  generateSegmentAudio,
  formatDuration as formatTTSDuration,
  type TTSProvider,
} from "./tts-provider.js";

// Export utility functions
export { debugLog, setDebugLogCacheDir, getDebugLogCacheDir } from "./utils.js";

// Export audio functions
export {
  stitchAudioFiles,
  stitchCachedSegments,
  saveManifest,
  loadManifest,
  getWavInfo,
  formatDuration,
  formatFileSize,
  estimateCost,
  estimateAudioDuration,
  getStitchSummary,
  type AudioFileInfo,
  type StitchResult,
} from "./audio.js";

// Export converter functions
export {
  convertToStoryFormat,
  convertWithGemini,
  convertLargeDocument,
  extractSpeakers as extractSpeakersFromConverted,
  validateConvertedContent,
  postProcessContent,
  getConversionPrompt,
  splitIntoChunks,
  estimateTokenCount,
  type ConversionOptions,
  type ConversionResult,
} from "./converter.js";

// Re-export for convenience
import { parseFile } from "./parser.js";
import { loadConfig, createConfigForSpeakers } from "./config.js";

/**
 * Quick start function for programmatic usage
 *
 * @example
 * ```typescript
 * import { quickGenerate } from './index.js';
 *
 * await quickGenerate('story.txt', './output', {
 *   apiKey: process.env.GEMINI_API_KEY,
 * });
 * ```
 */
export async function quickGenerate(
  storyPath: string,
  outputDir: string,
  options: {
    apiKey?: string;
    configPath?: string;
  } = {},
): Promise<void> {
  const { stitchAudioFiles } = await import("./audio.js");
  const { ensureCacheDir, getCachedSegmentPath } = await import("./cache.js");
  const { createTTSProvider, generateSegmentAudio } = await import(
    "./tts-provider.js"
  );
  const { mkdir } = await import("fs/promises");
  const { join, basename, extname } = await import("path");

  // Parse story
  const story = await parseFile(storyPath);

  // Load or create config
  let config;
  if (options.configPath) {
    config = await loadConfig(options.configPath);
  } else {
    config = createConfigForSpeakers(story.speakers);
  }

  // Override API key if provided
  if (options.apiKey) {
    config.provider.apiKey = options.apiKey;
  }

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  await ensureCacheDir(outputDir);

  // Initialize provider
  const provider = createTTSProvider(config);
  await provider.initialize();

  // Generate all segments
  const audioFiles: Array<{
    path: string;
    index: number;
    speaker: string;
    text: string;
  }> = [];

  for (const segment of story.segments) {
    const outputPath = getCachedSegmentPath(
      outputDir,
      segment.id,
      config.audio.format,
    );

    const response = await generateSegmentAudio(
      provider,
      segment,
      config,
      outputPath,
    );

    if (response.success && response.audioPath) {
      audioFiles.push({
        path: response.audioPath,
        index: segment.index,
        speaker: segment.speaker,
        text: segment.text,
      });
    }
  }

  // Stitch together
  const outputFileName = `${basename(storyPath, extname(storyPath))}_audiobook.wav`;
  const outputPath = join(outputDir, outputFileName);

  await stitchAudioFiles(audioFiles, outputPath, {
    silencePaddingMs: config.audio.silencePadding,
    title: basename(storyPath, extname(storyPath)),
    sourceFile: storyPath,
  });

  console.log(`Audiobook generated: ${outputPath}`);
}
