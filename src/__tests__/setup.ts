/**
 * Vitest test setup file
 *
 * This file runs before all tests and sets up the testing environment.
 */

import { vi, beforeEach, afterEach } from "vitest";

// Mock environment variables for testing
process.env.GEMINI_API_KEY = "test-api-key-12345";
process.env.NODE_ENV = "test";

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Clean up after each test
afterEach(() => {
  vi.restoreAllMocks();
});

// Global test utilities
declare global {
  // eslint-disable-next-line no-var
  var testUtils: {
    /**
     * Create a mock file system structure
     */
    createMockFs: (files: Record<string, string | Buffer>) => void;
    /**
     * Wait for a specified number of milliseconds
     */
    wait: (ms: number) => Promise<void>;
  };
}

globalThis.testUtils = {
  createMockFs: (_files: Record<string, string | Buffer>) => {
    // This will be implemented by individual tests using vi.mock
  },
  wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Suppress console output during tests (optional, comment out for debugging)
// vi.spyOn(console, 'log').mockImplementation(() => {});
// vi.spyOn(console, 'warn').mockImplementation(() => {});
// vi.spyOn(console, 'error').mockImplementation(() => {});
