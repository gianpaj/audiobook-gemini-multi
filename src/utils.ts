/**
 * Utility functions for the audiobook generation system
 */

import { appendFile } from "fs/promises";

// ============================================================================
// Debug Logging
// ============================================================================

// Debug log file path - set TTS_DEBUG_LOG env var to enable file logging
const DEBUG_LOG_FILE = process.env.TTS_DEBUG_LOG || null;

// Cache folder path for storing debug logs (set by setDebugLogCacheDir)
let debugLogCacheDir: string | null = null;

/**
 * Set the cache directory for debug logs
 * When set, debug logs will be written to {cacheDir}/debug.log
 */
export function setDebugLogCacheDir(cacheDir: string | null): void {
  debugLogCacheDir = cacheDir;
}

/**
 * Get the current debug log cache directory
 */
export function getDebugLogCacheDir(): string | null {
  return debugLogCacheDir;
}

// ============================================================================
// Concurrent Processing
// ============================================================================

/**
 * Result of processing a single item
 */
export interface ProcessResult<T, R> {
  /** The original item that was processed */
  item: T;
  /** Index of the item in the original array */
  index: number;
  /** Whether processing was successful */
  success: boolean;
  /** The result if successful */
  result?: R;
  /** Error message if failed */
  error?: string;
}

/**
 * Process an array of items with a concurrency limit
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param options - Processing options
 * @returns Array of results in the same order as input items
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: {
    /** Maximum concurrent operations (default: 4) */
    concurrency?: number;
    /** Callback when an item completes (for progress updates) */
    onProgress?: (
      completed: number,
      total: number,
      result: ProcessResult<T, R>,
    ) => void;
    /** Whether to stop on first error (default: false) */
    stopOnError?: boolean;
  } = {},
): Promise<ProcessResult<T, R>[]> {
  const { concurrency = 4, onProgress, stopOnError = false } = options;
  const results: ProcessResult<T, R>[] = new Array(items.length);
  let completedCount = 0;
  let hasError = false;

  // Process items using a semaphore pattern
  const semaphore = new Array(Math.min(concurrency, items.length)).fill(null);
  let nextIndex = 0;

  const processNext = async (_slotIndex: number): Promise<void> => {
    while (nextIndex < items.length && !(stopOnError && hasError)) {
      const currentIndex = nextIndex++;
      const item = items[currentIndex];

      try {
        const result = await processor(item, currentIndex);
        results[currentIndex] = {
          item,
          index: currentIndex,
          success: true,
          result,
        };
      } catch (err) {
        hasError = true;
        results[currentIndex] = {
          item,
          index: currentIndex,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      completedCount++;
      if (onProgress) {
        onProgress(completedCount, items.length, results[currentIndex]);
      }
    }
  };

  // Start concurrent workers
  await Promise.all(semaphore.map((_, i) => processNext(i)));

  return results;
}

/**
 * Write a debug log message
 *
 * Logs are written to:
 * 1. stderr (always)
 * 2. {cacheDir}/debug.log if setDebugLogCacheDir() was called
 * 3. TTS_DEBUG_LOG file if the environment variable is set
 */
export async function debugLog(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const logMessage = `\n[${timestamp}]\n${message}\n`;

  // Always write to stderr (won't be corrupted by progress bar as badly)
  process.stderr.write(logMessage);

  // Write to cache folder debug.log if configured
  if (debugLogCacheDir) {
    try {
      const debugLogPath = `${debugLogCacheDir}/debug.log`;
      await appendFile(debugLogPath, logMessage);
    } catch {
      // Ignore file write errors
    }
  }

  // Also write to env var file if configured (for backwards compatibility)
  if (DEBUG_LOG_FILE) {
    try {
      await appendFile(DEBUG_LOG_FILE, logMessage);
    } catch {
      // Ignore file write errors
    }
  }
}
