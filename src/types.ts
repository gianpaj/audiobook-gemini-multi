/**
 * Core types for the audiobook generation system
 */

// ============================================================================
// Parser Types
// ============================================================================

/**
 * A single segment of the story with speaker information
 */
export interface Segment {
  /** Unique identifier for the segment */
  id: string;
  /** Index of the segment in the story (0-based) */
  index: number;
  /** Speaker identifier (e.g., "NARRATOR", "CHARACTER1") */
  speaker: string;
  /** The text content for this segment */
  text: string;
  /** Line number in the source file where this segment starts */
  lineNumber: number;
}

/**
 * Result of parsing a story file
 */
export interface ParsedStory {
  /** Array of parsed segments */
  segments: Segment[];
  /** Unique speakers found in the story */
  speakers: string[];
  /** Total character count */
  totalCharacters: number;
  /** Source file path */
  sourcePath: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Voice configuration for a character
 */
export interface VoiceConfig {
  /** Character/speaker name (must match tags in story) */
  name: string;
  /** Voice seed for consistency across generations */
  seed?: number;
  /** Style prompt describing the voice (e.g., "warm elderly narrator") */
  stylePrompt?: string;
  /** TTS provider-specific voice name/ID */
  voiceName?: string;
  /** Speaking speed multiplier (0.5 = half speed, 2.0 = double speed) */
  speed?: number;
  /** Pitch adjustment (-1.0 to 1.0) */
  pitch?: number;
  /** Additional provider-specific parameters */
  extraParams?: Record<string, unknown>;
}

/**
 * TTS Provider configuration
 */
export interface ProviderConfig {
  /** Provider name (e.g., "gemini", "elevenlabs", "openai") */
  name: string;
  /** API key (can reference env var like "${GEMINI_API_KEY}") */
  apiKey?: string;
  /** Model to use */
  model?: string;
  /** Base URL for API (if applicable) */
  baseUrl?: string;
  /** Rate limit (requests per minute) */
  rateLimit?: number;
  /** Maximum retries on failure */
  maxRetries?: number;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Audio processing configuration
 */
export interface AudioConfig {
  /** Output format (mp3, wav, etc.) */
  format: "mp3" | "wav" | "ogg" | "flac";
  /** Sample rate in Hz */
  sampleRate?: number;
  /** Bit depth for wav output */
  bitDepth?: 16 | 24 | 32;
  /** Silence padding between segments in milliseconds */
  silencePadding?: number;
  /** Whether to normalize audio levels */
  normalize?: boolean;
}

/**
 * Main configuration file structure
 */
export interface Config {
  /** Version of the config schema */
  version: string;
  /** TTS provider configuration */
  provider: ProviderConfig;
  /** Audio output configuration */
  audio: AudioConfig;
  /** Voice configurations for each character */
  voices: VoiceConfig[];
  /** Default voice config for unmapped speakers */
  defaultVoice?: VoiceConfig;
  /** Global seed for reproducibility */
  globalSeed?: number;
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Hash of inputs that affect segment generation
 */
export interface SegmentHash {
  /** Hash of the text content */
  textHash: string;
  /** Hash of the voice configuration */
  voiceHash: string;
  /** Combined hash */
  combinedHash: string;
}

/**
 * Cached segment metadata
 */
export interface CachedSegment {
  /** Segment ID */
  segmentId: string;
  /** Segment index */
  index: number;
  /** Speaker name */
  speaker: string;
  /** Path to the generated audio file */
  audioPath: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** File size in bytes */
  fileSize: number;
  /** Hash for change detection */
  hash: SegmentHash;
  /** Timestamp when generated */
  generatedAt: string;
  /** Provider used for generation */
  provider: string;
  /** Whether generation was successful */
  success: boolean;
  /** Error message if generation failed */
  error?: string;
}

/**
 * Cache manifest structure
 */
export interface CacheManifest {
  /** Version of the cache schema */
  version: string;
  /** Source story file path */
  storyPath: string;
  /** Hash of the source story file */
  storyHash: string;
  /** Config hash for detecting config changes */
  configHash: string;
  /** Cached segments */
  segments: CachedSegment[];
  /** Last update timestamp */
  lastUpdated: string;
  /** Generation statistics */
  stats: GenerationStats;
}

// ============================================================================
// Generation Types
// ============================================================================

/**
 * Statistics for a generation run
 */
export interface GenerationStats {
  /** Total segments */
  totalSegments: number;
  /** Successfully generated segments */
  generatedSegments: number;
  /** Segments loaded from cache */
  cachedSegments: number;
  /** Failed segments */
  failedSegments: number;
  /** Total generation time in milliseconds */
  totalTimeMs: number;
  /** Estimated cost (if available) */
  estimatedCost?: number;
  /** Total audio duration in milliseconds */
  totalAudioDurationMs: number;
}

/**
 * Progress update during generation
 */
export interface GenerationProgress {
  /** Current segment index (0-based) */
  current: number;
  /** Total segments */
  total: number;
  /** Current segment being processed */
  segment?: Segment;
  /** Current status */
  status: "pending" | "generating" | "cached" | "completed" | "failed";
  /** Message for display */
  message: string;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Estimated remaining time in milliseconds */
  estimatedRemainingMs?: number;
}

/**
 * Result of generating a single segment
 */
export interface SegmentGenerationResult {
  /** Segment that was processed */
  segment: Segment;
  /** Whether generation was successful */
  success: boolean;
  /** Path to the generated audio file */
  audioPath?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** File size in bytes */
  fileSize?: number;
  /** Whether this was loaded from cache */
  fromCache: boolean;
  /** Error message if generation failed */
  error?: string;
  /** Time taken in milliseconds */
  timeTakenMs: number;
}

/**
 * Final audiobook generation result
 */
export interface AudiobookResult {
  /** Path to the final stitched audiobook */
  outputPath: string;
  /** Path to the manifest file */
  manifestPath: string;
  /** Generation statistics */
  stats: GenerationStats;
  /** Individual segment results */
  segmentResults: SegmentGenerationResult[];
  /** Whether all segments were successful */
  success: boolean;
  /** Errors encountered */
  errors: string[];
  /** Path to generated Audacity project (if --audacity used) */
  audacityProjectPath?: string;
}

// ============================================================================
// Manifest Types
// ============================================================================

/**
 * Segment entry in the export manifest
 */
export interface ManifestSegment {
  /** Segment index */
  index: number;
  /** Speaker name */
  speaker: string;
  /** Text content */
  text: string;
  /** Start timestamp in milliseconds */
  startMs: number;
  /** End timestamp in milliseconds */
  endMs: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Path to individual audio file */
  audioFile: string;
}

/**
 * Export manifest for the audiobook
 */
export interface AudiobookManifest {
  /** Version of the manifest schema */
  version: string;
  /** Title of the audiobook (from config or filename) */
  title: string;
  /** Source story file */
  sourceFile: string;
  /** Output audiobook file */
  outputFile: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Audio format */
  format: string;
  /** Sample rate */
  sampleRate: number;
  /** Speakers in the audiobook */
  speakers: string[];
  /** Segment details with timestamps */
  segments: ManifestSegment[];
  /** Generation timestamp */
  generatedAt: string;
  /** Provider used */
  provider: string;
}

// ============================================================================
// TTS Provider Types
// ============================================================================

/**
 * Request to generate audio for a segment
 */
export interface TTSRequest {
  /** Text to synthesize */
  text: string;
  /** Voice configuration to use */
  voice: VoiceConfig;
  /** Output file path */
  outputPath: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Segment ID for logging purposes */
  segmentId?: string;
}

/**
 * Response from TTS generation
 */
export interface TTSResponse {
  /** Whether generation was successful */
  success: boolean;
  /** Path to the generated audio file */
  audioPath?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** File size in bytes */
  fileSize?: number;
  /** Audio data as buffer (if not written to file) */
  audioData?: Buffer;
  /** Error message if generation failed */
  error?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Multi-speaker TTS request (for providers that support it)
 */
export interface MultiSpeakerTTSRequest {
  /** Segments to generate (in order) */
  segments: Array<{
    speaker: string;
    text: string;
  }>;
  /** Voice configurations by speaker name */
  voices: Map<string, VoiceConfig>;
  /** Output file path */
  outputPath: string;
  /** Global seed for reproducibility */
  seed?: number;
}

// ============================================================================
// CLI Types
// ============================================================================

/**
 * Options for the generate command
 */
export interface GenerateOptions {
  /** Path to config file */
  config?: string;
  /** Output directory */
  output?: string;
  /** Force regeneration (ignore cache) */
  force?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Dry run (don't generate, just show what would be done) */
  dryRun?: boolean;
  /** Number of segments to generate in parallel (default: 4) */
  concurrency?: number;
  /** Create Audacity project with individual segment tracks */
  audacity?: boolean;
}

/**
 * Options for the preview command
 */
export interface PreviewOptions extends GenerateOptions {
  /** Number of segments to preview */
  segments?: number;
  /** Start from specific segment index */
  startFrom?: number;
  /** Specific speaker to preview */
  speaker?: string;
}

/** Default concurrency for parallel segment generation */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Options for the update-styles command
 */
export interface UpdateStylesOptions {
  /** Path to config file */
  config?: string;
  /** Specific speakers to update */
  speakers?: string[];
  /** Force update even if unchanged */
  force?: boolean;
}

/**
 * Options for the clean command
 */
export interface CleanOptions {
  /** Only clean cache, keep generated files */
  cacheOnly?: boolean;
  /** Only clean output files, keep cache */
  outputOnly?: boolean;
  /** Don't ask for confirmation */
  force?: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted during generation
 */
export type GenerationEvent =
  | { type: "start"; totalSegments: number }
  | { type: "segment-start"; segment: Segment }
  | { type: "segment-complete"; result: SegmentGenerationResult }
  | { type: "segment-cached"; segment: Segment; cachedInfo: CachedSegment }
  | { type: "segment-error"; segment: Segment; error: string }
  | { type: "progress"; progress: GenerationProgress }
  | { type: "stitching-start"; segmentCount: number }
  | { type: "stitching-complete"; outputPath: string }
  | { type: "complete"; result: AudiobookResult }
  | { type: "error"; error: string };

/**
 * Event handler function type
 */
export type GenerationEventHandler = (event: GenerationEvent) => void;
