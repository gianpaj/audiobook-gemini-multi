/**
 * Tests for the audio module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";
import {
  formatDuration,
  formatFileSize,
  estimateCost,
  estimateAudioDuration,
  getStitchSummary,
  type StitchResult,
} from "../audio.js";

import type { AudiobookManifest } from "../types.js";

import {
  createWavHeader,
  createSilentWav,
  createToneWav,
  calculateWavDuration,
  extractWavData,
  SILENT_WAV_100MS,
  SILENT_WAV_500MS,
  SILENT_WAV_1S,
  TONE_WAV_100MS,
  INVALID_WAV_TOO_SHORT,
  INVALID_WAV_BAD_RIFF,
  EMPTY_WAV,
} from "../fixtures/audio.js";

// Mock fs/promises
vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

describe("audio", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vol.reset();
  });

  describe("WAV fixtures", () => {
    describe("createWavHeader", () => {
      it("should create valid 44-byte header", () => {
        const header = createWavHeader(1000);

        expect(header.length).toBe(44);
        expect(header.toString("ascii", 0, 4)).toBe("RIFF");
        expect(header.toString("ascii", 8, 12)).toBe("WAVE");
        expect(header.toString("ascii", 12, 16)).toBe("fmt ");
        expect(header.toString("ascii", 36, 40)).toBe("data");
      });

      it("should set correct chunk size", () => {
        const dataLength = 48000;
        const header = createWavHeader(dataLength);

        // ChunkSize = 36 + dataLength
        expect(header.readUInt32LE(4)).toBe(36 + dataLength);
      });

      it("should set correct data size", () => {
        const dataLength = 48000;
        const header = createWavHeader(dataLength);

        expect(header.readUInt32LE(40)).toBe(dataLength);
      });

      it("should use default values", () => {
        const header = createWavHeader(1000);

        expect(header.readUInt16LE(22)).toBe(1); // numChannels
        expect(header.readUInt32LE(24)).toBe(24000); // sampleRate
        expect(header.readUInt16LE(34)).toBe(16); // bitsPerSample
      });

      it("should use custom values", () => {
        const header = createWavHeader(1000, {
          numChannels: 2,
          sampleRate: 44100,
          bitsPerSample: 24,
        });

        expect(header.readUInt16LE(22)).toBe(2);
        expect(header.readUInt32LE(24)).toBe(44100);
        expect(header.readUInt16LE(34)).toBe(24);
      });

      it("should calculate correct byte rate", () => {
        const header = createWavHeader(1000, {
          numChannels: 2,
          sampleRate: 44100,
          bitsPerSample: 16,
        });

        // byteRate = sampleRate * numChannels * bitsPerSample / 8
        const expectedByteRate = (44100 * 2 * 16) / 8;
        expect(header.readUInt32LE(28)).toBe(expectedByteRate);
      });

      it("should calculate correct block align", () => {
        const header = createWavHeader(1000, {
          numChannels: 2,
          bitsPerSample: 16,
        });

        // blockAlign = numChannels * bitsPerSample / 8
        const expectedBlockAlign = (2 * 16) / 8;
        expect(header.readUInt16LE(32)).toBe(expectedBlockAlign);
      });
    });

    describe("createSilentWav", () => {
      it("should create WAV with correct total size", () => {
        const wav = createSilentWav(100);
        // 44 byte header + data
        const expectedDataSize = Math.floor((100 / 1000) * 24000) * 2; // 16-bit = 2 bytes
        expect(wav.length).toBe(44 + expectedDataSize);
      });

      it("should create silence (all zeros in data)", () => {
        const wav = createSilentWav(100);
        const data = wav.subarray(44);

        // All data bytes should be 0
        for (let i = 0; i < data.length; i++) {
          expect(data[i]).toBe(0);
        }
      });

      it("should respect duration parameter", () => {
        const wav100 = createSilentWav(100);
        const wav500 = createSilentWav(500);

        expect(wav500.length).toBeGreaterThan(wav100.length);
      });

      it("should respect custom sample rate", () => {
        const wav24k = createSilentWav(100, { sampleRate: 24000 });
        const wav44k = createSilentWav(100, { sampleRate: 44100 });

        expect(wav44k.length).toBeGreaterThan(wav24k.length);
      });
    });

    describe("createToneWav", () => {
      it("should create WAV with non-zero data", () => {
        const wav = createToneWav(100, 440);
        const data = wav.subarray(44);

        // At least some data bytes should be non-zero
        let hasNonZero = false;
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== 0) {
            hasNonZero = true;
            break;
          }
        }
        expect(hasNonZero).toBe(true);
      });

      it("should create valid WAV header", () => {
        const wav = createToneWav(100, 440);

        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
      });
    });

    describe("calculateWavDuration", () => {
      it("should calculate correct duration for 100ms WAV", () => {
        const duration = calculateWavDuration(SILENT_WAV_100MS);
        // Allow for small rounding differences
        expect(Math.abs(duration - 100)).toBeLessThan(5);
      });

      it("should calculate correct duration for 500ms WAV", () => {
        const duration = calculateWavDuration(SILENT_WAV_500MS);
        expect(Math.abs(duration - 500)).toBeLessThan(5);
      });

      it("should calculate correct duration for 1s WAV", () => {
        const duration = calculateWavDuration(SILENT_WAV_1S);
        expect(Math.abs(duration - 1000)).toBeLessThan(5);
      });

      it("should return 0 for too short buffer", () => {
        const duration = calculateWavDuration(INVALID_WAV_TOO_SHORT);
        expect(duration).toBe(0);
      });
    });

    describe("extractWavData", () => {
      it("should extract data portion from WAV", () => {
        const wav = createSilentWav(100);
        const data = extractWavData(wav);

        expect(data.length).toBe(wav.length - 44);
      });

      it("should return empty buffer for header-only WAV", () => {
        const data = extractWavData(EMPTY_WAV);
        expect(data.length).toBe(0);
      });

      it("should preserve data content", () => {
        const wav = createToneWav(100, 440);
        const data = extractWavData(wav);
        const directData = wav.subarray(44);

        expect(data.equals(directData)).toBe(true);
      });
    });

    describe("pre-created fixtures", () => {
      it("SILENT_WAV_100MS should be valid", () => {
        expect(SILENT_WAV_100MS.length).toBeGreaterThan(44);
        expect(SILENT_WAV_100MS.toString("ascii", 0, 4)).toBe("RIFF");
      });

      it("TONE_WAV_100MS should be valid", () => {
        expect(TONE_WAV_100MS.length).toBeGreaterThan(44);
        expect(TONE_WAV_100MS.toString("ascii", 0, 4)).toBe("RIFF");
      });

      it("INVALID_WAV_TOO_SHORT should be too short", () => {
        expect(INVALID_WAV_TOO_SHORT.length).toBeLessThan(44);
      });

      it("INVALID_WAV_BAD_RIFF should not have RIFF header", () => {
        expect(INVALID_WAV_BAD_RIFF.toString("ascii", 0, 4)).not.toBe("RIFF");
      });
    });
  });

  describe("formatDuration", () => {
    it("should format seconds only", () => {
      expect(formatDuration(30000)).toBe("0:30");
      expect(formatDuration(5000)).toBe("0:05");
    });

    it("should format minutes and seconds", () => {
      expect(formatDuration(60000)).toBe("1:00");
      expect(formatDuration(90000)).toBe("1:30");
      expect(formatDuration(125000)).toBe("2:05");
    });

    it("should format hours, minutes, and seconds", () => {
      expect(formatDuration(3600000)).toBe("1:00:00");
      expect(formatDuration(3661000)).toBe("1:01:01");
      expect(formatDuration(7325000)).toBe("2:02:05");
    });

    it("should handle zero", () => {
      expect(formatDuration(0)).toBe("0:00");
    });

    it("should pad seconds with zero", () => {
      expect(formatDuration(65000)).toBe("1:05");
    });
  });

  describe("formatFileSize", () => {
    it("should format bytes", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(100)).toBe("100 B");
      expect(formatFileSize(1023)).toBe("1023 B");
    });

    it("should format kilobytes", () => {
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
      expect(formatFileSize(10240)).toBe("10 KB");
    });

    it("should format megabytes", () => {
      expect(formatFileSize(1048576)).toBe("1 MB");
      expect(formatFileSize(5242880)).toBe("5 MB");
      expect(formatFileSize(1572864)).toBe("1.5 MB");
    });

    it("should format gigabytes", () => {
      expect(formatFileSize(1073741824)).toBe("1 GB");
      expect(formatFileSize(2147483648)).toBe("2 GB");
    });
  });

  describe("estimateCost", () => {
    it("should calculate cost based on character count", () => {
      // Default rate is $15 per million characters
      const cost = estimateCost(1000000);
      expect(cost).toBe(15);
    });

    it("should scale linearly with characters", () => {
      const cost1 = estimateCost(500000);
      const cost2 = estimateCost(1000000);
      expect(cost2).toBe(cost1 * 2);
    });

    it("should use custom price rate", () => {
      const cost = estimateCost(1000000, 30);
      expect(cost).toBe(30);
    });

    it("should handle small character counts", () => {
      const cost = estimateCost(1000);
      expect(cost).toBe(0.015);
    });

    it("should return 0 for 0 characters", () => {
      const cost = estimateCost(0);
      expect(cost).toBe(0);
    });
  });

  describe("estimateAudioDuration", () => {
    it("should estimate duration based on character count", () => {
      // ~150 words per minute, ~5 chars per word
      // 750 characters = ~150 words = ~1 minute = 60000ms
      const duration = estimateAudioDuration(750);
      expect(duration).toBe(60000);
    });

    it("should scale linearly with characters", () => {
      const duration1 = estimateAudioDuration(750);
      const duration2 = estimateAudioDuration(1500);
      expect(duration2).toBe(duration1 * 2);
    });

    it("should return 0 for 0 characters", () => {
      const duration = estimateAudioDuration(0);
      expect(duration).toBe(0);
    });

    it("should handle large texts", () => {
      // 75000 chars = ~100 minutes = 6000000ms
      const duration = estimateAudioDuration(75000);
      expect(duration).toBe(6000000);
    });
  });

  describe("getStitchSummary", () => {
    const mockManifest: AudiobookManifest = {
      version: "1.0.0",
      title: "Test Audiobook",
      sourceFile: "story.txt",
      outputFile: "audiobook.wav",
      totalDurationMs: 180000,
      format: "wav",
      sampleRate: 24000,
      speakers: ["NARRATOR", "ALICE"],
      segments: [],
      generatedAt: "2024-01-15T10:00:00.000Z",
      provider: "gemini",
    };

    const mockStitchResult: StitchResult = {
      outputPath: "/output/audiobook.wav",
      totalDurationMs: 180000,
      segmentCount: 10,
      fileSize: 8640000,
      manifest: mockManifest,
    };

    it("should include output path", () => {
      const summary = getStitchSummary(mockStitchResult);
      expect(summary).toContain("/output/audiobook.wav");
    });

    it("should include formatted duration", () => {
      const summary = getStitchSummary(mockStitchResult);
      expect(summary).toContain("3:00"); // 180000ms = 3 minutes
    });

    it("should include segment count", () => {
      const summary = getStitchSummary(mockStitchResult);
      expect(summary).toContain("10");
    });

    it("should include file size", () => {
      const summary = getStitchSummary(mockStitchResult);
      expect(summary).toContain("MB"); // 8.6MB
    });

    it("should include speakers", () => {
      const summary = getStitchSummary(mockStitchResult);
      expect(summary).toContain("NARRATOR");
      expect(summary).toContain("ALICE");
    });

    it("should include success header", () => {
      const summary = getStitchSummary(mockStitchResult);
      expect(summary).toContain("Audiobook Generated Successfully");
    });
  });
});
