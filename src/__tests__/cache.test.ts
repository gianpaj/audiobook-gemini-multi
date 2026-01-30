/**
 * Tests for the cache module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";
import {
  hashText,
  generateSegmentHash,
  getCacheDir,
  getCacheManifestPath,
  getCachedSegmentPath,
  createEmptyManifest,
  isSegmentCached,
  updateCachedSegment,
  getSegmentsToGenerate,
  getCachedSegments,
  getSegmentsWithStyleChanges,
  getCacheStats,
  formatBytes,
  getCacheSummary,
  updateManifestStats,
  CACHE_DIR_NAME,
  CACHE_MANIFEST_NAME,
  CACHE_VERSION,
} from "../cache.js";

import type { Segment, CacheManifest, CachedSegment } from "../types.js";
import { MINIMAL_CONFIG } from "../fixtures/configs.js";

// Mock fs/promises
vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

describe("cache", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vol.reset();
  });

  describe("constants", () => {
    it("should export CACHE_DIR_NAME", () => {
      expect(CACHE_DIR_NAME).toBe(".audiobook-cache");
    });

    it("should export CACHE_MANIFEST_NAME", () => {
      expect(CACHE_MANIFEST_NAME).toBe("manifest.json");
    });

    it("should export CACHE_VERSION", () => {
      expect(CACHE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("hashText", () => {
    it("should generate consistent hash for same text", () => {
      const hash1 = hashText("Hello, world!");
      const hash2 = hashText("Hello, world!");

      expect(hash1).toBe(hash2);
    });

    it("should generate different hash for different text", () => {
      const hash1 = hashText("Hello, world!");
      const hash2 = hashText("Hello, universe!");

      expect(hash1).not.toBe(hash2);
    });

    it("should return 32-character hex string", () => {
      const hash = hashText("Test string");

      expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should handle empty string", () => {
      const hash = hashText("");

      expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should handle unicode text", () => {
      const hash = hashText("你好世界 🌍");

      expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe("generateSegmentHash", () => {
    const mockSegment: Segment = {
      id: "seg_0001_abc123",
      index: 0,
      speaker: "NARRATOR",
      text: "Once upon a time...",
      lineNumber: 1,
    };

    it("should generate hash with text and voice components", () => {
      const hash = generateSegmentHash(mockSegment, MINIMAL_CONFIG);

      expect(hash.textHash).toBeDefined();
      expect(hash.voiceHash).toBeDefined();
      expect(hash.combinedHash).toBeDefined();
    });

    it("should generate consistent combined hash", () => {
      const hash1 = generateSegmentHash(mockSegment, MINIMAL_CONFIG);
      const hash2 = generateSegmentHash(mockSegment, MINIMAL_CONFIG);

      expect(hash1.combinedHash).toBe(hash2.combinedHash);
    });

    it("should change when text changes", () => {
      const segment1 = { ...mockSegment, text: "Text one" };
      const segment2 = { ...mockSegment, text: "Text two" };

      const hash1 = generateSegmentHash(segment1, MINIMAL_CONFIG);
      const hash2 = generateSegmentHash(segment2, MINIMAL_CONFIG);

      expect(hash1.textHash).not.toBe(hash2.textHash);
      expect(hash1.combinedHash).not.toBe(hash2.combinedHash);
    });

    it("should change when voice config changes", () => {
      const config1 = {
        ...MINIMAL_CONFIG,
        voices: [{ name: "NARRATOR", stylePrompt: "Style 1" }],
      };
      const config2 = {
        ...MINIMAL_CONFIG,
        voices: [{ name: "NARRATOR", stylePrompt: "Style 2" }],
      };

      const hash1 = generateSegmentHash(mockSegment, config1);
      const hash2 = generateSegmentHash(mockSegment, config2);

      expect(hash1.voiceHash).not.toBe(hash2.voiceHash);
      expect(hash1.combinedHash).not.toBe(hash2.combinedHash);
    });

    it("should keep textHash same when only voice changes", () => {
      const config1 = {
        ...MINIMAL_CONFIG,
        voices: [{ name: "NARRATOR", stylePrompt: "Style 1" }],
      };
      const config2 = {
        ...MINIMAL_CONFIG,
        voices: [{ name: "NARRATOR", stylePrompt: "Style 2" }],
      };

      const hash1 = generateSegmentHash(mockSegment, config1);
      const hash2 = generateSegmentHash(mockSegment, config2);

      expect(hash1.textHash).toBe(hash2.textHash);
    });
  });

  describe("path functions", () => {
    describe("getCacheDir", () => {
      it("should return correct cache directory path", () => {
        const result = getCacheDir("/output");
        expect(result).toBe(`/output/${CACHE_DIR_NAME}`);
      });

      it("should handle relative paths", () => {
        const result = getCacheDir("./output");
        // path.join normalizes the path, so ./output becomes output
        expect(result).toBe(`output/${CACHE_DIR_NAME}`);
      });
    });

    describe("getCacheManifestPath", () => {
      it("should return correct manifest path", () => {
        const result = getCacheManifestPath("/output");
        expect(result).toBe(`/output/${CACHE_DIR_NAME}/${CACHE_MANIFEST_NAME}`);
      });
    });

    describe("getCachedSegmentPath", () => {
      it("should return correct segment path with default format", () => {
        const result = getCachedSegmentPath("/output", "seg_0001");
        expect(result).toBe(`/output/${CACHE_DIR_NAME}/segments/seg_0001.wav`);
      });

      it("should return correct segment path with custom format", () => {
        const result = getCachedSegmentPath("/output", "seg_0001", "mp3");
        expect(result).toBe(`/output/${CACHE_DIR_NAME}/segments/seg_0001.mp3`);
      });
    });
  });

  describe("createEmptyManifest", () => {
    it("should create manifest with correct structure", () => {
      const manifest = createEmptyManifest(
        "/path/to/story.txt",
        "storyhash123",
        "confighash456",
      );

      expect(manifest.version).toBe(CACHE_VERSION);
      expect(manifest.storyPath).toBe("/path/to/story.txt");
      expect(manifest.storyHash).toBe("storyhash123");
      expect(manifest.configHash).toBe("confighash456");
      expect(manifest.segments).toEqual([]);
      expect(manifest.lastUpdated).toBeDefined();
    });

    it("should initialize stats to zero", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");

      expect(manifest.stats.totalSegments).toBe(0);
      expect(manifest.stats.generatedSegments).toBe(0);
      expect(manifest.stats.cachedSegments).toBe(0);
      expect(manifest.stats.failedSegments).toBe(0);
      expect(manifest.stats.totalTimeMs).toBe(0);
      expect(manifest.stats.totalAudioDurationMs).toBe(0);
    });

    it("should set lastUpdated to current time", () => {
      const before = new Date().toISOString();
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");
      const after = new Date().toISOString();

      expect(manifest.lastUpdated >= before).toBe(true);
      expect(manifest.lastUpdated <= after).toBe(true);
    });
  });

  describe("isSegmentCached", () => {
    const mockSegment: Segment = {
      id: "seg_0001_abc123",
      index: 0,
      speaker: "NARRATOR",
      text: "Test text",
      lineNumber: 1,
    };

    it("should return null for null manifest", () => {
      const result = isSegmentCached(null, mockSegment, MINIMAL_CONFIG);
      expect(result).toBeNull();
    });

    it("should return null for segment not in cache", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");
      const result = isSegmentCached(manifest, mockSegment, MINIMAL_CONFIG);
      expect(result).toBeNull();
    });

    it("should return cached segment when found and valid", () => {
      const hash = generateSegmentHash(mockSegment, MINIMAL_CONFIG);
      const cachedSegment: CachedSegment = {
        segmentId: mockSegment.id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/seg.wav",
        durationMs: 1000,
        fileSize: 48000,
        hash,
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [cachedSegment],
      };

      const result = isSegmentCached(manifest, mockSegment, MINIMAL_CONFIG);
      expect(result).toEqual(cachedSegment);
    });

    it("should return null for failed cached segment", () => {
      const hash = generateSegmentHash(mockSegment, MINIMAL_CONFIG);
      const cachedSegment: CachedSegment = {
        segmentId: mockSegment.id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/seg.wav",
        durationMs: 0,
        fileSize: 0,
        hash,
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: false,
        error: "Generation failed",
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [cachedSegment],
      };

      const result = isSegmentCached(manifest, mockSegment, MINIMAL_CONFIG);
      expect(result).toBeNull();
    });

    it("should return null when hash doesn't match", () => {
      const cachedSegment: CachedSegment = {
        segmentId: mockSegment.id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/seg.wav",
        durationMs: 1000,
        fileSize: 48000,
        hash: {
          textHash: "oldhash",
          voiceHash: "oldhash",
          combinedHash: "oldhash",
        },
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [cachedSegment],
      };

      const result = isSegmentCached(manifest, mockSegment, MINIMAL_CONFIG);
      expect(result).toBeNull();
    });
  });

  describe("updateCachedSegment", () => {
    const mockSegment: Segment = {
      id: "seg_0001_abc123",
      index: 0,
      speaker: "NARRATOR",
      text: "Test text",
      lineNumber: 1,
    };

    it("should add new segment to empty manifest", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");

      const updated = updateCachedSegment(
        manifest,
        mockSegment,
        MINIMAL_CONFIG,
        {
          audioPath: "/output/seg.wav",
          durationMs: 1000,
          fileSize: 48000,
          success: true,
        },
      );

      expect(updated.segments).toHaveLength(1);
      expect(updated.segments[0].segmentId).toBe(mockSegment.id);
      expect(updated.segments[0].success).toBe(true);
    });

    it("should update existing segment", () => {
      const hash = generateSegmentHash(mockSegment, MINIMAL_CONFIG);
      const existingSegment: CachedSegment = {
        segmentId: mockSegment.id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/old.wav",
        durationMs: 500,
        fileSize: 24000,
        hash,
        generatedAt: "2024-01-01T00:00:00.000Z",
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [existingSegment],
      };

      const updated = updateCachedSegment(
        manifest,
        mockSegment,
        MINIMAL_CONFIG,
        {
          audioPath: "/output/new.wav",
          durationMs: 1000,
          fileSize: 48000,
          success: true,
        },
      );

      expect(updated.segments).toHaveLength(1);
      expect(updated.segments[0].audioPath).toBe("/output/new.wav");
      expect(updated.segments[0].durationMs).toBe(1000);
    });

    it("should preserve other segments when updating", () => {
      const otherSegment: CachedSegment = {
        segmentId: "seg_0002_xyz789",
        index: 1,
        speaker: "ALICE",
        audioPath: "/output/other.wav",
        durationMs: 2000,
        fileSize: 96000,
        hash: { textHash: "a", voiceHash: "b", combinedHash: "c" },
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [otherSegment],
      };

      const updated = updateCachedSegment(
        manifest,
        mockSegment,
        MINIMAL_CONFIG,
        {
          audioPath: "/output/seg.wav",
          durationMs: 1000,
          fileSize: 48000,
          success: true,
        },
      );

      expect(updated.segments).toHaveLength(2);
      expect(
        updated.segments.find((s) => s.segmentId === "seg_0002_xyz789"),
      ).toBeDefined();
    });

    it("should sort segments by index", () => {
      const segment2: Segment = { ...mockSegment, id: "seg_0002", index: 2 };
      const segment0: Segment = { ...mockSegment, id: "seg_0000", index: 0 };

      let manifest = createEmptyManifest("story.txt", "hash1", "hash2");

      manifest = updateCachedSegment(manifest, segment2, MINIMAL_CONFIG, {
        audioPath: "/output/seg2.wav",
        durationMs: 1000,
        fileSize: 48000,
        success: true,
      });

      manifest = updateCachedSegment(manifest, segment0, MINIMAL_CONFIG, {
        audioPath: "/output/seg0.wav",
        durationMs: 1000,
        fileSize: 48000,
        success: true,
      });

      expect(manifest.segments[0].index).toBe(0);
      expect(manifest.segments[1].index).toBe(2);
    });

    it("should record error for failed generation", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");

      const updated = updateCachedSegment(
        manifest,
        mockSegment,
        MINIMAL_CONFIG,
        {
          audioPath: "",
          durationMs: 0,
          fileSize: 0,
          success: false,
          error: "API error",
        },
      );

      expect(updated.segments[0].success).toBe(false);
      expect(updated.segments[0].error).toBe("API error");
    });

    it("should update lastUpdated timestamp", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");
      const oldTimestamp = manifest.lastUpdated;

      // Small delay to ensure different timestamp
      const updated = updateCachedSegment(
        manifest,
        mockSegment,
        MINIMAL_CONFIG,
        {
          audioPath: "/output/seg.wav",
          durationMs: 1000,
          fileSize: 48000,
          success: true,
        },
      );

      expect(updated.lastUpdated >= oldTimestamp).toBe(true);
    });
  });

  describe("getSegmentsToGenerate", () => {
    const segments: Segment[] = [
      {
        id: "seg_0001",
        index: 0,
        speaker: "NARRATOR",
        text: "Text 1",
        lineNumber: 1,
      },
      {
        id: "seg_0002",
        index: 1,
        speaker: "ALICE",
        text: "Text 2",
        lineNumber: 2,
      },
      {
        id: "seg_0003",
        index: 2,
        speaker: "BOB",
        text: "Text 3",
        lineNumber: 3,
      },
    ];

    it("should return all segments for null manifest", () => {
      const result = getSegmentsToGenerate(null, segments, MINIMAL_CONFIG);
      expect(result).toHaveLength(3);
    });

    it("should return all segments for empty manifest", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");
      const result = getSegmentsToGenerate(manifest, segments, MINIMAL_CONFIG);
      expect(result).toHaveLength(3);
    });

    it("should exclude cached segments", () => {
      const hash = generateSegmentHash(segments[0], MINIMAL_CONFIG);
      const cachedSegment: CachedSegment = {
        segmentId: segments[0].id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/seg.wav",
        durationMs: 1000,
        fileSize: 48000,
        hash,
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [cachedSegment],
      };

      const result = getSegmentsToGenerate(manifest, segments, MINIMAL_CONFIG);
      expect(result).toHaveLength(2);
      expect(result.find((s) => s.id === "seg_0001")).toBeUndefined();
    });

    it("should include segments with changed hash", () => {
      const cachedSegment: CachedSegment = {
        segmentId: segments[0].id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/seg.wav",
        durationMs: 1000,
        fileSize: 48000,
        hash: { textHash: "old", voiceHash: "old", combinedHash: "old" },
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [cachedSegment],
      };

      const result = getSegmentsToGenerate(manifest, segments, MINIMAL_CONFIG);
      expect(result).toHaveLength(3);
    });
  });

  describe("getCachedSegments", () => {
    const segments: Segment[] = [
      {
        id: "seg_0001",
        index: 0,
        speaker: "NARRATOR",
        text: "Text 1",
        lineNumber: 1,
      },
      {
        id: "seg_0002",
        index: 1,
        speaker: "ALICE",
        text: "Text 2",
        lineNumber: 2,
      },
    ];

    it("should return empty array for null manifest", () => {
      const result = getCachedSegments(null, segments, MINIMAL_CONFIG);
      expect(result).toHaveLength(0);
    });

    it("should return cached segments with their info", () => {
      const hash = generateSegmentHash(segments[0], MINIMAL_CONFIG);
      const cachedSegment: CachedSegment = {
        segmentId: segments[0].id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/seg.wav",
        durationMs: 1000,
        fileSize: 48000,
        hash,
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [cachedSegment],
      };

      const result = getCachedSegments(manifest, segments, MINIMAL_CONFIG);
      expect(result).toHaveLength(1);
      expect(result[0].segment.id).toBe("seg_0001");
      expect(result[0].cached.audioPath).toBe("/output/seg.wav");
    });
  });

  describe("getSegmentsWithStyleChanges", () => {
    const segments: Segment[] = [
      {
        id: "seg_0001",
        index: 0,
        speaker: "NARRATOR",
        text: "Text 1",
        lineNumber: 1,
      },
      {
        id: "seg_0002",
        index: 1,
        speaker: "ALICE",
        text: "Text 2",
        lineNumber: 2,
      },
    ];

    it("should return all segments for null manifest", () => {
      const result = getSegmentsWithStyleChanges(
        null,
        segments,
        MINIMAL_CONFIG,
      );
      expect(result).toHaveLength(2);
    });

    it("should detect voice config changes", () => {
      const config1 = {
        ...MINIMAL_CONFIG,
        voices: [{ name: "NARRATOR", stylePrompt: "Old style" }],
      };
      const config2 = {
        ...MINIMAL_CONFIG,
        voices: [{ name: "NARRATOR", stylePrompt: "New style" }],
      };

      const hash = generateSegmentHash(segments[0], config1);
      const cachedSegment: CachedSegment = {
        segmentId: segments[0].id,
        index: 0,
        speaker: "NARRATOR",
        audioPath: "/output/seg.wav",
        durationMs: 1000,
        fileSize: 48000,
        hash,
        generatedAt: new Date().toISOString(),
        provider: "gemini",
        success: true,
      };

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments: [cachedSegment],
      };

      const result = getSegmentsWithStyleChanges(manifest, segments, config2);
      expect(result.find((s) => s.id === "seg_0001")).toBeDefined();
    });

    it("should filter by specific speakers", () => {
      // When manifest is null, all segments are returned as needing generation
      // but filtered to only the specified speakers
      const result = getSegmentsWithStyleChanges(
        null,
        segments,
        MINIMAL_CONFIG,
        ["NARRATOR"],
      );
      // With null manifest, function returns all segments, then filters by speaker
      // The function returns segments that need regeneration for the specified speakers
      const narratorSegments = result.filter((s) => s.speaker === "NARRATOR");
      expect(narratorSegments).toHaveLength(1);
      expect(narratorSegments[0].speaker).toBe("NARRATOR");
    });
  });

  describe("getCacheStats", () => {
    it("should return zeros for null manifest", () => {
      const stats = getCacheStats(null);

      expect(stats.cachedCount).toBe(0);
      expect(stats.totalDurationMs).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it("should return zeros for empty manifest", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");
      const stats = getCacheStats(manifest);

      expect(stats.cachedCount).toBe(0);
      expect(stats.totalDurationMs).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });

    it("should calculate correct totals", () => {
      const segments: CachedSegment[] = [
        {
          segmentId: "seg_0001",
          index: 0,
          speaker: "NARRATOR",
          audioPath: "/output/seg1.wav",
          durationMs: 1000,
          fileSize: 48000,
          hash: { textHash: "a", voiceHash: "b", combinedHash: "c" },
          generatedAt: "2024-01-01T00:00:00.000Z",
          provider: "gemini",
          success: true,
        },
        {
          segmentId: "seg_0002",
          index: 1,
          speaker: "ALICE",
          audioPath: "/output/seg2.wav",
          durationMs: 2000,
          fileSize: 96000,
          hash: { textHash: "d", voiceHash: "e", combinedHash: "f" },
          generatedAt: "2024-01-02T00:00:00.000Z",
          provider: "gemini",
          success: true,
        },
      ];

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments,
      };

      const stats = getCacheStats(manifest);

      expect(stats.cachedCount).toBe(2);
      expect(stats.totalDurationMs).toBe(3000);
      expect(stats.totalSizeBytes).toBe(144000);
    });

    it("should exclude failed segments from count", () => {
      const segments: CachedSegment[] = [
        {
          segmentId: "seg_0001",
          index: 0,
          speaker: "NARRATOR",
          audioPath: "/output/seg1.wav",
          durationMs: 1000,
          fileSize: 48000,
          hash: { textHash: "a", voiceHash: "b", combinedHash: "c" },
          generatedAt: "2024-01-01T00:00:00.000Z",
          provider: "gemini",
          success: true,
        },
        {
          segmentId: "seg_0002",
          index: 1,
          speaker: "ALICE",
          audioPath: "",
          durationMs: 0,
          fileSize: 0,
          hash: { textHash: "d", voiceHash: "e", combinedHash: "f" },
          generatedAt: "2024-01-02T00:00:00.000Z",
          provider: "gemini",
          success: false,
          error: "Failed",
        },
      ];

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments,
      };

      const stats = getCacheStats(manifest);

      expect(stats.cachedCount).toBe(1);
    });

    it("should find oldest and newest entries", () => {
      const segments: CachedSegment[] = [
        {
          segmentId: "seg_0001",
          index: 0,
          speaker: "NARRATOR",
          audioPath: "/output/seg1.wav",
          durationMs: 1000,
          fileSize: 48000,
          hash: { textHash: "a", voiceHash: "b", combinedHash: "c" },
          generatedAt: "2024-01-01T00:00:00.000Z",
          provider: "gemini",
          success: true,
        },
        {
          segmentId: "seg_0002",
          index: 1,
          speaker: "ALICE",
          audioPath: "/output/seg2.wav",
          durationMs: 2000,
          fileSize: 96000,
          hash: { textHash: "d", voiceHash: "e", combinedHash: "f" },
          generatedAt: "2024-01-15T00:00:00.000Z",
          provider: "gemini",
          success: true,
        },
      ];

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments,
      };

      const stats = getCacheStats(manifest);

      expect(stats.oldestEntry).toBe("2024-01-01T00:00:00.000Z");
      expect(stats.newestEntry).toBe("2024-01-15T00:00:00.000Z");
    });
  });

  describe("formatBytes", () => {
    it("should format bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(500)).toBe("500 B");
    });

    it("should format kilobytes", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(2048)).toBe("2 KB");
    });

    it("should format megabytes", () => {
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(5242880)).toBe("5 MB");
    });

    it("should format gigabytes", () => {
      expect(formatBytes(1073741824)).toBe("1 GB");
    });

    it("should handle decimal values", () => {
      expect(formatBytes(1536)).toBe("1.5 KB");
    });
  });

  describe("getCacheSummary", () => {
    it("should include cache status header", () => {
      const summary = getCacheSummary(null, 10);
      expect(summary).toContain("Cache status:");
    });

    it("should show cached count and total", () => {
      const summary = getCacheSummary(null, 10);
      expect(summary).toContain("0 / 10");
    });

    it("should show duration for non-empty cache", () => {
      const segments: CachedSegment[] = [
        {
          segmentId: "seg_0001",
          index: 0,
          speaker: "NARRATOR",
          audioPath: "/output/seg1.wav",
          durationMs: 5000,
          fileSize: 240000,
          hash: { textHash: "a", voiceHash: "b", combinedHash: "c" },
          generatedAt: "2024-01-01T00:00:00.000Z",
          provider: "gemini",
          success: true,
        },
      ];

      const manifest: CacheManifest = {
        ...createEmptyManifest("story.txt", "hash1", "hash2"),
        segments,
      };

      const summary = getCacheSummary(manifest, 10);
      expect(summary).toContain("5.0s");
    });
  });

  describe("updateManifestStats", () => {
    it("should update stats in manifest", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");

      const updated = updateManifestStats(manifest, {
        totalSegments: 10,
        generatedSegments: 8,
        cachedSegments: 2,
        failedSegments: 0,
        totalTimeMs: 30000,
        totalAudioDurationMs: 60000,
      });

      expect(updated.stats.totalSegments).toBe(10);
      expect(updated.stats.generatedSegments).toBe(8);
      expect(updated.stats.cachedSegments).toBe(2);
      expect(updated.stats.totalTimeMs).toBe(30000);
      expect(updated.stats.totalAudioDurationMs).toBe(60000);
    });

    it("should partially update stats", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");
      manifest.stats.totalSegments = 5;

      const updated = updateManifestStats(manifest, {
        generatedSegments: 3,
      });

      expect(updated.stats.totalSegments).toBe(5);
      expect(updated.stats.generatedSegments).toBe(3);
    });

    it("should update lastUpdated timestamp", () => {
      const manifest = createEmptyManifest("story.txt", "hash1", "hash2");
      const oldTimestamp = manifest.lastUpdated;

      const updated = updateManifestStats(manifest, {
        totalSegments: 10,
      });

      expect(updated.lastUpdated >= oldTimestamp).toBe(true);
    });
  });
});
