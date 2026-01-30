/**
 * Audio processing module for stitching segments together
 *
 * Handles:
 * - Concatenating multiple audio files
 * - Adding silence padding between segments
 * - Generating manifests with timestamps
 * - Basic audio format handling
 */

import { readFile, writeFile, stat, access } from "fs/promises";
import { dirname, basename, extname } from "path";
import { mkdir } from "fs/promises";
import type {
  AudioConfig,
  CachedSegment,
  AudiobookManifest,
  ManifestSegment,
  Segment,
} from "./types.js";

// ============================================================================
// WAV File Utilities
// ============================================================================

interface WavHeader {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataSize: number;
}

/**
 * Parse WAV file header
 */
function parseWavHeader(buffer: Buffer): WavHeader | null {
  if (buffer.length < 44) {
    return null;
  }

  // Verify RIFF header
  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);

  if (riff !== "RIFF" || wave !== "WAVE") {
    return null;
  }

  return {
    numChannels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    bitsPerSample: buffer.readUInt16LE(34),
    dataSize: buffer.readUInt32LE(40),
  };
}

/**
 * Create a WAV header buffer
 */
function createWavHeader(
  dataLength: number,
  numChannels: number,
  sampleRate: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

/**
 * Extract raw audio data from WAV file (skip header)
 */
function extractWavData(buffer: Buffer): Buffer {
  // Find the data chunk
  let offset = 12;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "data") {
      return buffer.subarray(offset + 8, offset + 8 + chunkSize);
    }

    offset += 8 + chunkSize;
    // Word align
    if (chunkSize % 2 !== 0) {
      offset++;
    }
  }

  // Fallback: assume standard 44-byte header
  return buffer.subarray(44);
}

/**
 * Generate silence buffer
 */
function generateSilence(
  durationMs: number,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
): Buffer {
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const bufferSize = numSamples * numChannels * bytesPerSample;

  // Return zero-filled buffer (silence)
  return Buffer.alloc(bufferSize, 0);
}

/**
 * Calculate duration in milliseconds from WAV data
 */
function calculateDuration(
  dataSize: number,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
): number {
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = dataSize / (numChannels * bytesPerSample);
  return (numSamples / sampleRate) * 1000;
}

// ============================================================================
// Audio Stitching
// ============================================================================

/**
 * Information about an audio file to be stitched
 */
export interface AudioFileInfo {
  /** Path to the audio file */
  path: string;
  /** Segment index */
  index: number;
  /** Speaker name */
  speaker: string;
  /** Text content */
  text: string;
  /** Duration in milliseconds (will be calculated if not provided) */
  durationMs?: number;
}

/**
 * Result of stitching operation
 */
export interface StitchResult {
  /** Path to the output file */
  outputPath: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Number of segments stitched */
  segmentCount: number;
  /** Output file size in bytes */
  fileSize: number;
  /** Manifest with timestamps */
  manifest: AudiobookManifest;
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
 * Stitch multiple WAV files together
 */
export async function stitchAudioFiles(
  files: AudioFileInfo[],
  outputPath: string,
  options: {
    silencePaddingMs?: number;
    sampleRate?: number;
    numChannels?: number;
    bitsPerSample?: number;
    title?: string;
    sourceFile?: string;
  } = {},
): Promise<StitchResult> {
  const {
    silencePaddingMs = 500,
    sampleRate = 24000,
    numChannels = 1,
    bitsPerSample = 16,
    title = "Audiobook",
    sourceFile = "unknown",
  } = options;

  // Sort files by index
  const sortedFiles = [...files].sort((a, b) => a.index - b.index);

  // Read all audio files and extract data
  const audioChunks: Buffer[] = [];
  const manifestSegments: ManifestSegment[] = [];
  let currentPositionMs = 0;

  // Generate silence padding buffer
  const silenceBuffer = generateSilence(
    silencePaddingMs,
    sampleRate,
    numChannels,
    bitsPerSample,
  );

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];

    // Check if file exists
    if (!(await fileExists(file.path))) {
      throw new Error(`Audio file not found: ${file.path}`);
    }

    // Read the WAV file
    const wavBuffer = await readFile(file.path);
    const header = parseWavHeader(wavBuffer);

    if (!header) {
      throw new Error(`Invalid WAV file: ${file.path}`);
    }

    // Extract raw audio data
    const audioData = extractWavData(wavBuffer);

    // Calculate duration
    const durationMs =
      file.durationMs ||
      calculateDuration(
        audioData.length,
        header.sampleRate,
        header.numChannels,
        header.bitsPerSample,
      );

    // Add to manifest
    manifestSegments.push({
      index: file.index,
      speaker: file.speaker,
      text: file.text,
      startMs: currentPositionMs,
      endMs: currentPositionMs + durationMs,
      durationMs,
      audioFile: basename(file.path),
    });

    // Add audio data
    audioChunks.push(audioData);
    currentPositionMs += durationMs;

    // Add silence padding between segments (except after the last one)
    if (i < sortedFiles.length - 1 && silencePaddingMs > 0) {
      audioChunks.push(silenceBuffer);
      currentPositionMs += silencePaddingMs;
    }
  }

  // Combine all audio chunks
  const combinedAudioData = Buffer.concat(audioChunks);

  // Create WAV header for the combined file
  const wavHeader = createWavHeader(
    combinedAudioData.length,
    numChannels,
    sampleRate,
    bitsPerSample,
  );

  // Combine header and data
  const finalBuffer = Buffer.concat([wavHeader, combinedAudioData]);

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // Write the output file
  await writeFile(outputPath, finalBuffer);

  // Get file stats
  const fileStats = await stat(outputPath);

  // Create manifest
  const manifest: AudiobookManifest = {
    version: "1.0.0",
    title,
    sourceFile,
    outputFile: basename(outputPath),
    totalDurationMs: currentPositionMs,
    format: "wav",
    sampleRate,
    speakers: [...new Set(sortedFiles.map((f) => f.speaker))],
    segments: manifestSegments,
    generatedAt: new Date().toISOString(),
    provider: "gemini",
  };

  return {
    outputPath,
    totalDurationMs: currentPositionMs,
    segmentCount: sortedFiles.length,
    fileSize: fileStats.size,
    manifest,
  };
}

/**
 * Stitch cached segments together
 */
export async function stitchCachedSegments(
  cachedSegments: Array<{ segment: Segment; cached: CachedSegment }>,
  outputPath: string,
  audioConfig: AudioConfig,
  storyPath: string,
  title?: string,
): Promise<StitchResult> {
  const files: AudioFileInfo[] = cachedSegments.map(({ segment, cached }) => ({
    path: cached.audioPath,
    index: segment.index,
    speaker: segment.speaker,
    text: segment.text,
    durationMs: cached.durationMs,
  }));

  return stitchAudioFiles(files, outputPath, {
    silencePaddingMs: audioConfig.silencePadding,
    sampleRate: audioConfig.sampleRate,
    numChannels: 1,
    bitsPerSample: audioConfig.bitDepth,
    title: title || basename(storyPath, extname(storyPath)),
    sourceFile: storyPath,
  });
}

/**
 * Save manifest to file
 */
export async function saveManifest(
  manifest: AudiobookManifest,
  outputPath: string,
): Promise<void> {
  const content = JSON.stringify(manifest, null, 2);
  await writeFile(outputPath, content, "utf-8");
}

/**
 * Load manifest from file
 */
export async function loadManifest(
  manifestPath: string,
): Promise<AudiobookManifest | null> {
  try {
    const content = await readFile(manifestPath, "utf-8");
    return JSON.parse(content) as AudiobookManifest;
  } catch {
    return null;
  }
}

// ============================================================================
// Audio Analysis Utilities
// ============================================================================

/**
 * Get WAV file info
 */
export async function getWavInfo(filePath: string): Promise<{
  durationMs: number;
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  fileSize: number;
} | null> {
  try {
    const buffer = await readFile(filePath);
    const header = parseWavHeader(buffer);

    if (!header) {
      return null;
    }

    const fileStats = await stat(filePath);
    const durationMs = calculateDuration(
      header.dataSize,
      header.sampleRate,
      header.numChannels,
      header.bitsPerSample,
    );

    return {
      durationMs,
      sampleRate: header.sampleRate,
      numChannels: header.numChannels,
      bitsPerSample: header.bitsPerSample,
      fileSize: fileStats.size,
    };
  } catch {
    return null;
  }
}

/**
 * Format duration in milliseconds to human-readable format
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format file size to human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Calculate estimated cost based on character count
 * (Placeholder - actual cost depends on provider)
 */
export function estimateCost(
  totalCharacters: number,
  pricePerMillionChars: number = 15,
): number {
  return (totalCharacters / 1000000) * pricePerMillionChars;
}

/**
 * Calculate estimated audio duration from character count
 * (Rough estimate: ~150 words per minute, ~5 chars per word)
 */
export function estimateAudioDuration(totalCharacters: number): number {
  const wordsPerMinute = 150;
  const charsPerWord = 5;
  const words = totalCharacters / charsPerWord;
  const minutes = words / wordsPerMinute;
  return minutes * 60 * 1000; // Return in milliseconds
}

/**
 * Print a summary of the stitching result
 */
export function getStitchSummary(result: StitchResult): string {
  const lines: string[] = [];

  lines.push(`Audiobook Generated Successfully`);
  lines.push(`================================`);
  lines.push(`Output: ${result.outputPath}`);
  lines.push(`Duration: ${formatDuration(result.totalDurationMs)}`);
  lines.push(`Segments: ${result.segmentCount}`);
  lines.push(`File size: ${formatFileSize(result.fileSize)}`);
  lines.push(`Speakers: ${result.manifest.speakers.join(", ")}`);

  return lines.join("\n");
}
