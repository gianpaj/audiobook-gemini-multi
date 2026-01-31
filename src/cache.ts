/**
 * Cache management module for tracking generated audio segments
 *
 * Provides functionality to:
 * - Track which segments have been generated
 * - Detect changes in text or style prompts
 * - Support resuming interrupted generations
 * - Clean up stale cache entries
 * - Recover cached segments from existing audio files
 */

import {
  readFile,
  writeFile,
  access,
  mkdir,
  unlink,
  readdir,
  stat,
} from "fs/promises";
import { join, basename } from "path";
import { createHash } from "crypto";
import type {
  CacheManifest,
  CachedSegment,
  SegmentHash,
  Segment,
  Config,
  GenerationStats,
} from "./types.js";
import { hashVoiceConfig, getVoiceConfig } from "./config.js";

/**
 * Cache directory name
 */
export const CACHE_DIR_NAME = ".audiobook-cache";

/**
 * Cache manifest filename
 */
export const CACHE_MANIFEST_NAME = "manifest.json";

/**
 * Current cache schema version
 */
export const CACHE_VERSION = "1.0.0";

/**
 * Generate a hash of text content
 */
export function hashText(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

/**
 * Generate a short hash (8 characters) for use in folder names
 */
export function shortHash(text: string): string {
  return createHash("md5").update(text).digest("hex").substring(0, 8);
}

/**
 * Generate a hash for a segment (text + voice config)
 */
export function generateSegmentHash(
  segment: Segment,
  config: Config,
): SegmentHash {
  const voiceConfig = getVoiceConfig(config, segment.speaker);
  const textHash = hashText(segment.text);
  const voiceHash = hashVoiceConfig(voiceConfig);
  const combinedHash = createHash("md5")
    .update(`${textHash}-${voiceHash}`)
    .digest("hex");

  return {
    textHash,
    voiceHash,
    combinedHash,
  };
}

/**
 * Get the cache directory path for a project
 * If storyHash is provided, creates a story-specific subfolder
 */
export function getCacheDir(outputDir: string, storyHash?: string): string {
  if (storyHash) {
    const shortStoryHash = storyHash.substring(0, 8);
    return join(outputDir, CACHE_DIR_NAME, shortStoryHash);
  }
  return join(outputDir, CACHE_DIR_NAME);
}

/**
 * Get the cache manifest path
 */
export function getCacheManifestPath(
  outputDir: string,
  storyHash?: string,
): string {
  return join(getCacheDir(outputDir, storyHash), CACHE_MANIFEST_NAME);
}

/**
 * Get the path for a cached segment audio file
 */
export function getCachedSegmentPath(
  outputDir: string,
  segmentId: string,
  format: string = "wav",
  storyHash?: string,
): string {
  return join(
    getCacheDir(outputDir, storyHash),
    "segments",
    `${segmentId}.${format}`,
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
 * Recover cached segments from existing audio files
 * This is useful when the manifest was lost but audio files still exist
 */
export async function recoverCachedSegments(
  outputDir: string,
  segments: Segment[],
  config: Config,
  storyHash?: string,
): Promise<CachedSegment[]> {
  const recovered: CachedSegment[] = [];
  const cacheDir = getCacheDir(outputDir, storyHash);
  const segmentsDir = join(cacheDir, "segments");

  if (!(await fileExists(segmentsDir))) {
    return recovered;
  }

  for (const segment of segments) {
    const audioPath = getCachedSegmentPath(
      outputDir,
      segment.id,
      config.audio.format,
      storyHash,
    );

    if (await fileExists(audioPath)) {
      try {
        const fileStat = await stat(audioPath);
        const hash = generateSegmentHash(segment, config);

        recovered.push({
          segmentId: segment.id,
          index: segment.index,
          speaker: segment.speaker,
          audioPath,
          durationMs: 0, // Unknown, will be recalculated if needed
          fileSize: fileStat.size,
          hash,
          generatedAt: fileStat.mtime.toISOString(),
          provider: config.provider.name,
          success: true,
        });
      } catch {
        // Ignore errors reading file stats
      }
    }
  }

  return recovered;
}

/**
 * Ensure cache directory structure exists
 */
export async function ensureCacheDir(
  outputDir: string,
  storyHash?: string,
): Promise<void> {
  const cacheDir = getCacheDir(outputDir, storyHash);
  const segmentsDir = join(cacheDir, "segments");

  await mkdir(cacheDir, { recursive: true });
  await mkdir(segmentsDir, { recursive: true });
}

/**
 * Create an empty cache manifest
 */
export function createEmptyManifest(
  storyPath: string,
  storyHash: string,
  configHash: string,
): CacheManifest {
  return {
    version: CACHE_VERSION,
    storyPath,
    storyHash,
    configHash,
    segments: [],
    lastUpdated: new Date().toISOString(),
    stats: {
      totalSegments: 0,
      generatedSegments: 0,
      cachedSegments: 0,
      failedSegments: 0,
      totalTimeMs: 0,
      totalAudioDurationMs: 0,
    },
  };
}

/**
 * Load cache manifest from disk
 */
export async function loadCacheManifest(
  outputDir: string,
  storyHash?: string,
): Promise<CacheManifest | null> {
  const manifestPath = getCacheManifestPath(outputDir, storyHash);

  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    const content = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as CacheManifest;

    // Version check
    if (manifest.version !== CACHE_VERSION) {
      console.warn(
        `Cache version mismatch (${manifest.version} vs ${CACHE_VERSION}). Cache will be rebuilt.`,
      );
      return null;
    }

    return manifest;
  } catch (error) {
    console.warn(`Failed to load cache manifest: ${error}`);
    return null;
  }
}

/**
 * Save cache manifest to disk
 */
export async function saveCacheManifest(
  outputDir: string,
  manifest: CacheManifest,
  storyHash?: string,
): Promise<void> {
  await ensureCacheDir(outputDir, storyHash);
  const manifestPath = getCacheManifestPath(outputDir, storyHash);

  manifest.lastUpdated = new Date().toISOString();
  const content = JSON.stringify(manifest, null, 2);
  await writeFile(manifestPath, content, "utf-8");
}

/**
 * Check if a segment is cached and valid
 */
export function isSegmentCached(
  manifest: CacheManifest | null,
  segment: Segment,
  config: Config,
): CachedSegment | null {
  if (!manifest) {
    return null;
  }

  const cached = manifest.segments.find((s) => s.segmentId === segment.id);
  if (!cached) {
    return null;
  }

  // Check if the segment was successful
  if (!cached.success) {
    return null;
  }

  // Verify hash matches (text and voice config haven't changed)
  const currentHash = generateSegmentHash(segment, config);
  if (cached.hash.combinedHash !== currentHash.combinedHash) {
    return null;
  }

  return cached;
}

/**
 * Check if a cached segment's audio file exists
 */
export async function verifyCachedSegment(
  outputDir: string,
  cached: CachedSegment,
  storyHash?: string,
): Promise<boolean> {
  const cacheDir = getCacheDir(outputDir, storyHash);
  const audioPath = join(cacheDir, "segments", basename(cached.audioPath));
  return fileExists(audioPath);
}

/**
 * Add or update a segment in the cache manifest
 */
export function updateCachedSegment(
  manifest: CacheManifest,
  segment: Segment,
  config: Config,
  result: {
    audioPath: string;
    durationMs: number;
    fileSize: number;
    success: boolean;
    error?: string;
  },
): CacheManifest {
  const hash = generateSegmentHash(segment, config);
  const cachedSegment: CachedSegment = {
    segmentId: segment.id,
    index: segment.index,
    speaker: segment.speaker,
    audioPath: result.audioPath,
    durationMs: result.durationMs,
    fileSize: result.fileSize,
    hash,
    generatedAt: new Date().toISOString(),
    provider: config.provider.name,
    success: result.success,
    error: result.error,
  };

  // Remove existing entry if present
  const filteredSegments = manifest.segments.filter(
    (s) => s.segmentId !== segment.id,
  );

  return {
    ...manifest,
    segments: [...filteredSegments, cachedSegment].sort(
      (a, b) => a.index - b.index,
    ),
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Remove a segment from the cache
 */
export async function removeCachedSegment(
  outputDir: string,
  manifest: CacheManifest,
  segmentId: string,
): Promise<CacheManifest> {
  const cached = manifest.segments.find((s) => s.segmentId === segmentId);

  if (cached) {
    // Try to delete the audio file
    const audioPath = getCachedSegmentPath(outputDir, segmentId);
    try {
      await unlink(audioPath);
    } catch {
      // File may not exist, ignore
    }
  }

  return {
    ...manifest,
    segments: manifest.segments.filter((s) => s.segmentId !== segmentId),
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get segments that need to be generated (not in cache or changed)
 */
export function getSegmentsToGenerate(
  manifest: CacheManifest | null,
  segments: Segment[],
  config: Config,
): Segment[] {
  return segments.filter((segment) => {
    const cached = isSegmentCached(manifest, segment, config);
    return cached === null;
  });
}

/**
 * Get segments that are cached and valid
 */
export function getCachedSegments(
  manifest: CacheManifest | null,
  segments: Segment[],
  config: Config,
): Array<{ segment: Segment; cached: CachedSegment }> {
  const results: Array<{ segment: Segment; cached: CachedSegment }> = [];

  for (const segment of segments) {
    const cached = isSegmentCached(manifest, segment, config);
    if (cached) {
      results.push({ segment, cached });
    }
  }

  return results;
}

/**
 * Get segments that need regeneration due to style changes
 */
export function getSegmentsWithStyleChanges(
  manifest: CacheManifest | null,
  segments: Segment[],
  config: Config,
  speakers?: string[],
): Segment[] {
  if (!manifest) {
    return segments;
  }

  const normalizedSpeakers = speakers?.map((s) => s.toUpperCase());

  return segments.filter((segment) => {
    // If specific speakers are provided, only check those
    if (
      normalizedSpeakers &&
      !normalizedSpeakers.includes(segment.speaker.toUpperCase())
    ) {
      return false;
    }

    const cached = manifest.segments.find((s) => s.segmentId === segment.id);
    if (!cached) {
      return true; // Not cached, needs generation
    }

    // Check if voice config has changed
    const currentHash = generateSegmentHash(segment, config);
    return cached.hash.voiceHash !== currentHash.voiceHash;
  });
}

/**
 * Clean up stale cache entries (segments no longer in the story)
 */
export async function cleanStaleCacheEntries(
  outputDir: string,
  manifest: CacheManifest,
  currentSegmentIds: Set<string>,
): Promise<CacheManifest> {
  const staleSegments = manifest.segments.filter(
    (s) => !currentSegmentIds.has(s.segmentId),
  );

  let updatedManifest = { ...manifest };

  for (const stale of staleSegments) {
    updatedManifest = await removeCachedSegment(
      outputDir,
      updatedManifest,
      stale.segmentId,
    );
  }

  return updatedManifest;
}

/**
 * Calculate cache statistics
 */
export function getCacheStats(manifest: CacheManifest | null): {
  cachedCount: number;
  totalDurationMs: number;
  totalSizeBytes: number;
  oldestEntry: string | null;
  newestEntry: string | null;
} {
  if (!manifest || manifest.segments.length === 0) {
    return {
      cachedCount: 0,
      totalDurationMs: 0,
      totalSizeBytes: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }

  const successful = manifest.segments.filter((s) => s.success);
  const timestamps = successful.map((s) => new Date(s.generatedAt).getTime());

  return {
    cachedCount: successful.length,
    totalDurationMs: successful.reduce((sum, s) => sum + s.durationMs, 0),
    totalSizeBytes: successful.reduce((sum, s) => sum + s.fileSize, 0),
    oldestEntry:
      timestamps.length > 0
        ? new Date(Math.min(...timestamps)).toISOString()
        : null,
    newestEntry:
      timestamps.length > 0
        ? new Date(Math.max(...timestamps)).toISOString()
        : null,
  };
}

/**
 * Clear all cache for a project (or a specific story's cache)
 */
export async function clearCache(
  outputDir: string,
  storyHash?: string,
): Promise<void> {
  const cacheDir = getCacheDir(outputDir, storyHash);

  if (!(await fileExists(cacheDir))) {
    return;
  }

  // Delete all files in the segments directory
  const segmentsDir = join(cacheDir, "segments");
  if (await fileExists(segmentsDir)) {
    const files = await readdir(segmentsDir);
    for (const file of files) {
      await unlink(join(segmentsDir, file));
    }
  }

  // Delete the manifest
  const manifestPath = getCacheManifestPath(outputDir, storyHash);
  if (await fileExists(manifestPath)) {
    await unlink(manifestPath);
  }
}

/**
 * Get cache directory size in bytes
 */
export async function getCacheDirSize(
  outputDir: string,
  storyHash?: string,
): Promise<number> {
  const cacheDir = getCacheDir(outputDir, storyHash);

  if (!(await fileExists(cacheDir))) {
    return 0;
  }

  let totalSize = 0;

  const processDir = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await processDir(fullPath);
      } else {
        const fileStat = await stat(fullPath);
        totalSize += fileStat.size;
      }
    }
  };

  await processDir(cacheDir);
  return totalSize;
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get a summary of the cache status
 */
export function getCacheSummary(
  manifest: CacheManifest | null,
  totalSegments: number,
): string {
  const stats = getCacheStats(manifest);
  const lines: string[] = [];

  lines.push(`Cache status:`);
  lines.push(`  Cached segments: ${stats.cachedCount} / ${totalSegments}`);

  if (stats.cachedCount > 0) {
    lines.push(
      `  Total cached duration: ${(stats.totalDurationMs / 1000).toFixed(1)}s`,
    );
    lines.push(`  Total cache size: ${formatBytes(stats.totalSizeBytes)}`);

    if (stats.oldestEntry) {
      lines.push(`  Oldest entry: ${stats.oldestEntry}`);
    }
    if (stats.newestEntry) {
      lines.push(`  Newest entry: ${stats.newestEntry}`);
    }
  }

  return lines.join("\n");
}

/**
 * Update generation statistics in manifest
 */
export function updateManifestStats(
  manifest: CacheManifest,
  stats: Partial<GenerationStats>,
): CacheManifest {
  return {
    ...manifest,
    stats: {
      ...manifest.stats,
      ...stats,
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Invalidate cache entries for specific speakers
 */
export async function invalidateSpeakerCache(
  outputDir: string,
  manifest: CacheManifest,
  speakers: string[],
): Promise<CacheManifest> {
  const normalizedSpeakers = speakers.map((s) => s.toUpperCase());

  const toInvalidate = manifest.segments.filter((s) =>
    normalizedSpeakers.includes(s.speaker.toUpperCase()),
  );

  let updatedManifest = { ...manifest };

  for (const segment of toInvalidate) {
    updatedManifest = await removeCachedSegment(
      outputDir,
      updatedManifest,
      segment.segmentId,
    );
  }

  return updatedManifest;
}
