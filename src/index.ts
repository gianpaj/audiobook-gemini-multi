/**
 * Audiobook Generator - Main Entry Point
 *
 * A TypeScript CLI tool for generating audiobooks from story scripts
 * using Text-to-Speech APIs with multi-speaker support.
 *
 * @module audiobook-generator
 */

// Export analyzer functions
export {
	type AnalysisOptions,
	type AnalysisProvider,
	type AnalysisResult,
	analyzeStory,
	type Character,
	formatAnalysisResult,
	type Gender,
	getAnalysisPrompt,
	getApiKeyEnvVar,
	getDefaultModel,
	getDefaultModelId,
	getSpeakerListForConvert,
	getSupportedProviders,
} from "./analyzer.js";
// Export audio functions
export {
	type AudioFileInfo,
	estimateAudioDuration,
	estimateCost,
	formatDuration,
	formatFileSize,
	getStitchSummary,
	getWavInfo,
	loadManifest,
	type StitchResult,
	saveManifest,
	stitchAudioFiles,
	stitchCachedSegments,
} from "./audio.js";
// Export cache functions
export {
	CACHE_DIR_NAME,
	CACHE_MANIFEST_NAME,
	CACHE_VERSION,
	cleanStaleCacheEntries,
	clearCache,
	createEmptyManifest,
	ensureCacheDir,
	formatBytes,
	generateSegmentHash,
	getCacheDir,
	getCacheDirSize,
	getCachedSegmentPath,
	getCachedSegments,
	getCacheManifestPath,
	getCacheStats,
	getCacheSummary,
	getSegmentsToGenerate,
	getSegmentsWithStyleChanges,
	hashText,
	invalidateSpeakerCache,
	isSegmentCached,
	loadCacheManifest,
	removeCachedSegment,
	saveCacheManifest,
	shortHash,
	updateCachedSegment,
	updateManifestStats,
	updateSegmentIdsWithStyle,
	verifyCachedSegment,
} from "./cache.js";
// Export config functions
export {
	type ConfigValidationResult,
	createConfigForSpeakers,
	DEFAULT_CONFIG,
	DEFAULT_VOICES,
	exportConfigTemplate,
	GEMINI_VOICES,
	type GeminiVoice,
	getApiKey,
	getConfigSummary,
	getVoiceConfig,
	hashConfig,
	hashVoiceConfig,
	loadConfig,
	loadOrCreateConfig,
	mergeWithDefaults,
	resolveEnvVars,
	saveConfig,
	updateVoiceConfig,
	validateConfig,
} from "./config.js";
// Export converter functions
export {
	type ConversionOptions,
	type ConversionResult,
	convertLargeDocument,
	convertToStoryFormat,
	convertWithGemini,
	estimateTokenCount,
	extractSpeakers as extractSpeakersFromConverted,
	getConversionPrompt,
	postProcessContent,
	splitIntoChunks,
	validateConvertedContent,
} from "./converter.js";
// Export parser functions
export {
	convertFormat,
	detectFormat,
	extractSpeakers,
	filterBySpeaker,
	getSegmentRange,
	getStorySummary,
	type ParserOptions,
	parseContent,
	parseFile,
	type ValidationResult,
	validateParsedStory,
} from "./parser.js";
// Export TTS provider functions and classes
export {
	createTTSProvider,
	formatDuration as formatTTSDuration,
	GeminiTTSProvider,
	generateSegmentAudio,
	type TTSProvider,
} from "./tts-provider.js";
// Export all types
export type {
	AudiobookManifest,
	AudiobookResult,
	AudioConfig,
	CachedSegment,
	CacheManifest,
	CleanOptions,
	Config,
	// CLI types
	GenerateOptions,
	// Event types
	GenerationEvent,
	GenerationEventHandler,
	GenerationProgress,
	// Generation types
	GenerationStats,
	// Manifest types
	ManifestSegment,
	MultiSpeakerTTSRequest,
	ParsedStory,
	PreviewOptions,
	ProviderConfig,
	// Parser types
	Segment,
	SegmentGenerationResult,
	// Cache types
	SegmentHash,
	// TTS types
	TTSRequest,
	TTSResponse,
	UpdateStylesOptions,
	// Config types
	VoiceConfig,
} from "./types.js";
// Export constants
export { DEFAULT_CONCURRENCY } from "./types.js";
// Export utility functions
export {
	debugLog,
	getDebugLogCacheDir,
	type ProcessResult,
	processWithConcurrency,
	setDebugLogCacheDir,
} from "./utils.js";

// Export voice suggestion functions
export {
	formatVoiceSuggestions,
	formatVoiceSuggestionsAsConfig,
	GEMINI_VOICES_DATA,
	getFemaleVoices,
	getMaleVoices,
	getNeutralVoices,
	getVoiceByName,
	getVoicesByGender,
	suggestionsToVoiceConfigs,
	suggestVoiceForCharacter,
	suggestVoicesForAnalysis,
	type VoiceGender,
	type VoiceInfo,
	type VoicePitch,
	type VoiceSuggestion,
} from "./voices.js";

import { createConfigForSpeakers, loadConfig } from "./config.js";
// Re-export for convenience
import { parseFile } from "./parser.js";
import type { Config } from "./types.js";

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
	const { mkdir } = await import("node:fs/promises");
	const { join, basename, extname } = await import("node:path");

	// Parse story
	const story = await parseFile(storyPath);

	// Load or create config
	let config: Config | undefined;
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
