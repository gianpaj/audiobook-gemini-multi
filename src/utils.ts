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
