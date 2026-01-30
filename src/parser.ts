/**
 * Parser module for story scripts with speaker annotations
 *
 * Supports formats like:
 * [NARRATOR] Once upon a time...
 * [CHARACTER1] Hello there!
 * [CHARACTER2] Nice to meet you.
 *
 * Also supports colon format:
 * NARRATOR: Once upon a time...
 * CHARACTER1: Hello there!
 */

import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { basename } from "path";
import type { Segment, ParsedStory } from "./types.js";

/**
 * Regular expression patterns for parsing
 */
const PATTERNS = {
  // Matches [SPEAKER] text format
  bracketFormat: /^\[([A-Z][A-Z0-9_]*)\]\s*(.+)$/i,
  // Matches SPEAKER: text format (speaker must be at start of line)
  colonFormat: /^([A-Z][A-Z0-9_]*)\s*:\s*(.+)$/i,
  // Matches continuation lines (no speaker tag)
  continuationLine: /^\s{2,}(.+)$/,
  // Empty or whitespace-only line
  emptyLine: /^\s*$/,
  // Comment line (starts with # or //)
  commentLine: /^\s*(#|\/\/)/,
};

/**
 * Options for parsing
 */
export interface ParserOptions {
  /** Whether to trim whitespace from text */
  trimText?: boolean;
  /** Whether to merge consecutive segments from same speaker */
  mergeConsecutive?: boolean;
  /** Whether to preserve empty lines as segment breaks */
  preserveEmptyLines?: boolean;
  /** Custom speaker tag pattern (regex string) */
  customPattern?: string;
}

const DEFAULT_OPTIONS: ParserOptions = {
  trimText: true,
  mergeConsecutive: false,
  preserveEmptyLines: false,
};

/**
 * Generate a unique segment ID
 */
function generateSegmentId(index: number, speaker: string, text: string): string {
  const hash = createHash("md5")
    .update(`${index}-${speaker}-${text}`)
    .digest("hex")
    .substring(0, 8);
  return `seg_${index.toString().padStart(4, "0")}_${hash}`;
}

/**
 * Detect the format used in the story file
 */
export function detectFormat(content: string): "bracket" | "colon" | "mixed" | "unknown" {
  const lines = content.split("\n").filter((line) => !PATTERNS.emptyLine.test(line));

  let bracketCount = 0;
  let colonCount = 0;

  for (const line of lines.slice(0, 50)) {
    // Check first 50 non-empty lines
    if (PATTERNS.bracketFormat.test(line)) {
      bracketCount++;
    } else if (PATTERNS.colonFormat.test(line)) {
      colonCount++;
    }
  }

  if (bracketCount > 0 && colonCount > 0) {
    return "mixed";
  } else if (bracketCount > 0) {
    return "bracket";
  } else if (colonCount > 0) {
    return "colon";
  }
  return "unknown";
}

/**
 * Parse a single line and extract speaker and text
 */
function parseLine(
  line: string,
  options: ParserOptions
): { speaker: string; text: string } | null {
  // Skip empty lines and comments
  if (PATTERNS.emptyLine.test(line) || PATTERNS.commentLine.test(line)) {
    return null;
  }

  // Try custom pattern first if provided
  if (options.customPattern) {
    const customRegex = new RegExp(options.customPattern, "i");
    const customMatch = line.match(customRegex);
    if (customMatch && customMatch[1] && customMatch[2]) {
      return {
        speaker: customMatch[1].toUpperCase(),
        text: options.trimText ? customMatch[2].trim() : customMatch[2],
      };
    }
  }

  // Try bracket format: [SPEAKER] text
  const bracketMatch = line.match(PATTERNS.bracketFormat);
  if (bracketMatch) {
    return {
      speaker: bracketMatch[1].toUpperCase(),
      text: options.trimText ? bracketMatch[2].trim() : bracketMatch[2],
    };
  }

  // Try colon format: SPEAKER: text
  const colonMatch = line.match(PATTERNS.colonFormat);
  if (colonMatch) {
    return {
      speaker: colonMatch[1].toUpperCase(),
      text: options.trimText ? colonMatch[2].trim() : colonMatch[2],
    };
  }

  return null;
}

/**
 * Parse story content string into segments
 */
export function parseContent(
  content: string,
  sourcePath: string = "unknown",
  options: ParserOptions = {}
): ParsedStory {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines = content.split("\n");
  const segments: Segment[] = [];
  const speakersSet = new Set<string>();

  let currentSpeaker: string | null = null;
  let currentText: string[] = [];
  let currentLineNumber = 0;
  let segmentIndex = 0;

  const flushSegment = () => {
    if (currentSpeaker && currentText.length > 0) {
      const text = currentText.join(" ").trim();
      if (text) {
        const segment: Segment = {
          id: generateSegmentId(segmentIndex, currentSpeaker, text),
          index: segmentIndex,
          speaker: currentSpeaker,
          text,
          lineNumber: currentLineNumber,
        };
        segments.push(segment);
        speakersSet.add(currentSpeaker);
        segmentIndex++;
      }
    }
    currentText = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Skip comments
    if (PATTERNS.commentLine.test(line)) {
      continue;
    }

    // Handle empty lines
    if (PATTERNS.emptyLine.test(line)) {
      if (opts.preserveEmptyLines && currentSpeaker) {
        flushSegment();
        currentSpeaker = null;
      }
      continue;
    }

    // Try to parse as a speaker line
    const parsed = parseLine(line, opts);

    if (parsed) {
      // Check if we should merge with previous segment
      if (
        opts.mergeConsecutive &&
        currentSpeaker === parsed.speaker &&
        currentText.length > 0
      ) {
        currentText.push(parsed.text);
      } else {
        // Flush previous segment and start new one
        flushSegment();
        currentSpeaker = parsed.speaker;
        currentText = [parsed.text];
        currentLineNumber = lineNumber;
      }
    } else {
      // Check if this is a continuation line
      const continuationMatch = line.match(PATTERNS.continuationLine);
      if (continuationMatch && currentSpeaker) {
        currentText.push(opts.trimText ? continuationMatch[1].trim() : continuationMatch[1]);
      }
      // If no current speaker and not a continuation, treat as narrator or skip
    }
  }

  // Flush any remaining segment
  flushSegment();

  // Calculate total characters
  const totalCharacters = segments.reduce((sum, seg) => sum + seg.text.length, 0);

  return {
    segments,
    speakers: Array.from(speakersSet).sort(),
    totalCharacters,
    sourcePath,
  };
}

/**
 * Parse a story file from disk
 */
export async function parseFile(
  filePath: string,
  options: ParserOptions = {}
): Promise<ParsedStory> {
  const content = await readFile(filePath, "utf-8");
  return parseContent(content, filePath, options);
}

/**
 * Validate a parsed story
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateParsedStory(story: ParsedStory): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for empty story
  if (story.segments.length === 0) {
    errors.push("Story contains no segments");
  }

  // Check for very short segments
  const shortSegments = story.segments.filter((s) => s.text.length < 5);
  if (shortSegments.length > 0) {
    warnings.push(
      `Found ${shortSegments.length} very short segments (less than 5 characters)`
    );
  }

  // Check for very long segments
  const longSegments = story.segments.filter((s) => s.text.length > 5000);
  if (longSegments.length > 0) {
    warnings.push(
      `Found ${longSegments.length} very long segments (more than 5000 characters). Consider splitting.`
    );
  }

  // Check for unknown speakers (all caps, likely typos)
  const suspiciousSpeakers = story.speakers.filter(
    (s) => s.length > 20 || /[^A-Z0-9_]/.test(s)
  );
  if (suspiciousSpeakers.length > 0) {
    warnings.push(
      `Found suspicious speaker names: ${suspiciousSpeakers.join(", ")}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get a summary of the parsed story
 */
export function getStorySummary(story: ParsedStory): string {
  const lines: string[] = [];

  lines.push(`Story: ${basename(story.sourcePath)}`);
  lines.push(`Total segments: ${story.segments.length}`);
  lines.push(`Total characters: ${story.totalCharacters.toLocaleString()}`);
  lines.push(`Speakers (${story.speakers.length}): ${story.speakers.join(", ")}`);

  // Segment count per speaker
  const segmentsBySpeaker = new Map<string, number>();
  const charsBySpeaker = new Map<string, number>();

  for (const segment of story.segments) {
    segmentsBySpeaker.set(
      segment.speaker,
      (segmentsBySpeaker.get(segment.speaker) || 0) + 1
    );
    charsBySpeaker.set(
      segment.speaker,
      (charsBySpeaker.get(segment.speaker) || 0) + segment.text.length
    );
  }

  lines.push("\nSegments by speaker:");
  for (const speaker of story.speakers) {
    const count = segmentsBySpeaker.get(speaker) || 0;
    const chars = charsBySpeaker.get(speaker) || 0;
    lines.push(`  ${speaker}: ${count} segments, ${chars.toLocaleString()} characters`);
  }

  return lines.join("\n");
}

/**
 * Extract all unique speakers from content without full parsing
 * (useful for quick analysis)
 */
export function extractSpeakers(content: string): string[] {
  const speakers = new Set<string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const bracketMatch = line.match(PATTERNS.bracketFormat);
    if (bracketMatch) {
      speakers.add(bracketMatch[1].toUpperCase());
      continue;
    }

    const colonMatch = line.match(PATTERNS.colonFormat);
    if (colonMatch) {
      speakers.add(colonMatch[1].toUpperCase());
    }
  }

  return Array.from(speakers).sort();
}

/**
 * Convert story to different format
 */
export function convertFormat(
  story: ParsedStory,
  format: "bracket" | "colon"
): string {
  return story.segments
    .map((segment) => {
      if (format === "bracket") {
        return `[${segment.speaker}] ${segment.text}`;
      } else {
        return `${segment.speaker}: ${segment.text}`;
      }
    })
    .join("\n\n");
}

/**
 * Filter segments by speaker
 */
export function filterBySpeaker(story: ParsedStory, speakers: string[]): ParsedStory {
  const normalizedSpeakers = speakers.map((s) => s.toUpperCase());
  const filteredSegments = story.segments.filter((s) =>
    normalizedSpeakers.includes(s.speaker)
  );

  return {
    ...story,
    segments: filteredSegments,
    speakers: story.speakers.filter((s) => normalizedSpeakers.includes(s)),
    totalCharacters: filteredSegments.reduce((sum, s) => sum + s.text.length, 0),
  };
}

/**
 * Get a range of segments
 */
export function getSegmentRange(
  story: ParsedStory,
  start: number,
  count: number
): ParsedStory {
  const slicedSegments = story.segments.slice(start, start + count);

  return {
    ...story,
    segments: slicedSegments,
    speakers: [...new Set(slicedSegments.map((s) => s.speaker))].sort(),
    totalCharacters: slicedSegments.reduce((sum, s) => sum + s.text.length, 0),
  };
}
