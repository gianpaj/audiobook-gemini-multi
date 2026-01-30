/**
 * Tests for the parser module
 */

import { describe, it, expect } from "vitest";
import {
  parseContent,
  detectFormat,
  validateParsedStory,
  getStorySummary,
  extractSpeakers,
  convertFormat,
  filterBySpeaker,
  getSegmentRange,
} from "../parser.js";

import {
  BRACKET_FORMAT_STORY,
  COLON_FORMAT_STORY,
  MIXED_FORMAT_STORY,
  STORY_WITH_COMMENTS,
  STORY_WITH_EMPTY_LINES,
  SINGLE_SPEAKER_STORY,
  STORY_WITH_LONG_SEGMENT,
  STORY_WITH_SHORT_SEGMENTS,
  EMPTY_STORY,
  STORY_WITH_UNUSUAL_SPEAKERS,
  MULTI_SPEAKER_STORY,
  EXPECTED_BRACKET_SEGMENTS,
  EXPECTED_BRACKET_SPEAKERS,
  EXPECTED_MULTI_SPEAKERS,
} from "../fixtures/stories.js";

describe("parser", () => {
  describe("detectFormat", () => {
    it("should detect bracket format", () => {
      expect(detectFormat(BRACKET_FORMAT_STORY)).toBe("bracket");
    });

    it("should detect colon format", () => {
      expect(detectFormat(COLON_FORMAT_STORY)).toBe("colon");
    });

    it("should detect mixed format", () => {
      expect(detectFormat(MIXED_FORMAT_STORY)).toBe("mixed");
    });

    it("should return unknown for empty content", () => {
      expect(detectFormat("")).toBe("unknown");
      expect(detectFormat("   \n\n  ")).toBe("unknown");
    });

    it("should return unknown for content without speaker tags", () => {
      expect(detectFormat("Just some plain text without speakers.")).toBe("unknown");
    });
  });

  describe("parseContent", () => {
    describe("bracket format", () => {
      it("should parse bracket format story correctly", () => {
        const result = parseContent(BRACKET_FORMAT_STORY, "test.txt");

        expect(result.segments).toHaveLength(EXPECTED_BRACKET_SEGMENTS.length);
        expect(result.speakers).toEqual(EXPECTED_BRACKET_SPEAKERS);

        result.segments.forEach((segment, index) => {
          expect(segment.speaker).toBe(EXPECTED_BRACKET_SEGMENTS[index].speaker);
          expect(segment.text).toBe(EXPECTED_BRACKET_SEGMENTS[index].text);
          expect(segment.index).toBe(index);
          expect(segment.id).toMatch(/^seg_\d{4}_[a-f0-9]{8}$/);
        });
      });

      it("should track line numbers", () => {
        const result = parseContent(BRACKET_FORMAT_STORY, "test.txt");

        // First segment should be on line 1
        expect(result.segments[0].lineNumber).toBe(1);
      });

      it("should calculate total characters", () => {
        const result = parseContent(BRACKET_FORMAT_STORY, "test.txt");
        const expectedTotal = EXPECTED_BRACKET_SEGMENTS.reduce(
          (sum, seg) => sum + seg.text.length,
          0,
        );
        expect(result.totalCharacters).toBe(expectedTotal);
      });
    });

    describe("colon format", () => {
      it("should parse colon format story correctly", () => {
        const result = parseContent(COLON_FORMAT_STORY, "test.txt");

        expect(result.segments).toHaveLength(EXPECTED_BRACKET_SEGMENTS.length);
        expect(result.speakers).toEqual(EXPECTED_BRACKET_SPEAKERS);

        result.segments.forEach((segment, index) => {
          expect(segment.speaker).toBe(EXPECTED_BRACKET_SEGMENTS[index].speaker);
          expect(segment.text).toBe(EXPECTED_BRACKET_SEGMENTS[index].text);
        });
      });
    });

    describe("comments and empty lines", () => {
      it("should ignore comment lines", () => {
        const result = parseContent(STORY_WITH_COMMENTS, "test.txt");

        // Should have 3 segments (NARRATOR, ALICE, BOB)
        expect(result.segments).toHaveLength(3);

        // Comments should not appear in text
        result.segments.forEach((segment) => {
          expect(segment.text).not.toContain("#");
          expect(segment.text).not.toContain("//");
        });
      });

      it("should handle empty lines between segments", () => {
        const result = parseContent(STORY_WITH_EMPTY_LINES, "test.txt");

        expect(result.segments).toHaveLength(4);
        expect(result.speakers).toEqual(["ALICE", "BOB", "NARRATOR"]);
      });
    });

    describe("edge cases", () => {
      it("should handle single speaker story", () => {
        const result = parseContent(SINGLE_SPEAKER_STORY, "test.txt");

        expect(result.segments).toHaveLength(3);
        expect(result.speakers).toEqual(["NARRATOR"]);
      });

      it("should handle empty story", () => {
        const result = parseContent(EMPTY_STORY, "test.txt");

        expect(result.segments).toHaveLength(0);
        expect(result.speakers).toEqual([]);
        expect(result.totalCharacters).toBe(0);
      });

      it("should handle unusual speaker names", () => {
        const result = parseContent(STORY_WITH_UNUSUAL_SPEAKERS, "test.txt");

        expect(result.speakers).toContain("NARRATOR_V2");
        expect(result.speakers).toContain("CHARACTER_123");
        expect(result.speakers).toContain("A");
      });

      it("should normalize speaker names to uppercase", () => {
        const mixedCaseStory = "[narrator] Hello.\n[Alice] Hi!";
        const result = parseContent(mixedCaseStory, "test.txt");

        expect(result.speakers).toEqual(["ALICE", "NARRATOR"]);
        expect(result.segments[0].speaker).toBe("NARRATOR");
        expect(result.segments[1].speaker).toBe("ALICE");
      });

      it("should set source path", () => {
        const result = parseContent(BRACKET_FORMAT_STORY, "/path/to/story.txt");
        expect(result.sourcePath).toBe("/path/to/story.txt");
      });
    });

    describe("parser options", () => {
      it("should trim text by default", () => {
        const storyWithSpaces = "[NARRATOR]   Text with spaces   ";
        const result = parseContent(storyWithSpaces, "test.txt");

        expect(result.segments[0].text).toBe("Text with spaces");
      });

      it("should merge consecutive segments from same speaker when enabled", () => {
        const result = parseContent(SINGLE_SPEAKER_STORY, "test.txt", {
          mergeConsecutive: true,
        });

        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].text).toContain("This is a monologue");
        expect(result.segments[0].text).toContain("Only one speaker");
        expect(result.segments[0].text).toContain("No other characters");
      });
    });
  });

  describe("validateParsedStory", () => {
    it("should return valid for normal story", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const validation = validateParsedStory(story);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should return error for empty story", () => {
      const story = parseContent(EMPTY_STORY, "test.txt");
      const validation = validateParsedStory(story);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Story contains no segments");
    });

    it("should warn about very short segments", () => {
      const story = parseContent(STORY_WITH_SHORT_SEGMENTS, "test.txt");
      const validation = validateParsedStory(story);

      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings.some((w) => w.includes("very short segments"))).toBe(true);
    });

    it("should warn about very long segments", () => {
      const story = parseContent(STORY_WITH_LONG_SEGMENT, "test.txt");
      const validation = validateParsedStory(story);

      expect(validation.warnings.some((w) => w.includes("very long segments"))).toBe(true);
    });
  });

  describe("extractSpeakers", () => {
    it("should extract speakers from bracket format", () => {
      const speakers = extractSpeakers(BRACKET_FORMAT_STORY);
      expect(speakers).toEqual(EXPECTED_BRACKET_SPEAKERS);
    });

    it("should extract speakers from colon format", () => {
      const speakers = extractSpeakers(COLON_FORMAT_STORY);
      expect(speakers).toEqual(EXPECTED_BRACKET_SPEAKERS);
    });

    it("should extract speakers from multi-speaker story", () => {
      const speakers = extractSpeakers(MULTI_SPEAKER_STORY);
      expect(speakers).toEqual(EXPECTED_MULTI_SPEAKERS);
    });

    it("should return empty array for content without speakers", () => {
      const speakers = extractSpeakers("Just plain text");
      expect(speakers).toEqual([]);
    });
  });

  describe("getStorySummary", () => {
    it("should generate summary with correct information", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test-story.txt");
      const summary = getStorySummary(story);

      expect(summary).toContain("test-story.txt");
      expect(summary).toContain(`${story.segments.length}`);
      expect(summary).toContain(`${story.speakers.length}`);
      expect(summary).toContain("NARRATOR");
      expect(summary).toContain("ALICE");
      expect(summary).toContain("BOB");
    });

    it("should include segment counts by speaker", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const summary = getStorySummary(story);

      // NARRATOR has 4 segments in the test story
      expect(summary).toContain("NARRATOR:");
      expect(summary).toContain("segments");
      expect(summary).toContain("characters");
    });
  });

  describe("convertFormat", () => {
    it("should convert to bracket format", () => {
      const story = parseContent(COLON_FORMAT_STORY, "test.txt");
      const converted = convertFormat(story, "bracket");

      expect(converted).toContain("[NARRATOR]");
      expect(converted).toContain("[ALICE]");
      expect(converted).not.toContain("NARRATOR:");
    });

    it("should convert to colon format", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const converted = convertFormat(story, "colon");

      expect(converted).toContain("NARRATOR:");
      expect(converted).toContain("ALICE:");
      expect(converted).not.toContain("[NARRATOR]");
    });
  });

  describe("filterBySpeaker", () => {
    it("should filter segments by single speaker", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const filtered = filterBySpeaker(story, ["ALICE"]);

      expect(filtered.speakers).toEqual(["ALICE"]);
      filtered.segments.forEach((segment) => {
        expect(segment.speaker).toBe("ALICE");
      });
    });

    it("should filter segments by multiple speakers", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const filtered = filterBySpeaker(story, ["ALICE", "BOB"]);

      expect(filtered.speakers).toEqual(["ALICE", "BOB"]);
      filtered.segments.forEach((segment) => {
        expect(["ALICE", "BOB"]).toContain(segment.speaker);
      });
    });

    it("should handle case-insensitive speaker names", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const filtered = filterBySpeaker(story, ["alice", "bob"]);

      expect(filtered.speakers).toEqual(["ALICE", "BOB"]);
    });

    it("should return empty story for non-existent speaker", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const filtered = filterBySpeaker(story, ["NONEXISTENT"]);

      expect(filtered.segments).toHaveLength(0);
      expect(filtered.speakers).toHaveLength(0);
    });

    it("should update total characters", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const filtered = filterBySpeaker(story, ["ALICE"]);

      const expectedChars = filtered.segments.reduce((sum, s) => sum + s.text.length, 0);
      expect(filtered.totalCharacters).toBe(expectedChars);
    });
  });

  describe("getSegmentRange", () => {
    it("should return first N segments", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const range = getSegmentRange(story, 0, 3);

      expect(range.segments).toHaveLength(3);
      expect(range.segments[0].index).toBe(0);
      expect(range.segments[2].index).toBe(2);
    });

    it("should return segments from offset", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const range = getSegmentRange(story, 2, 3);

      expect(range.segments).toHaveLength(3);
      expect(range.segments[0].index).toBe(2);
    });

    it("should handle offset beyond story length", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const range = getSegmentRange(story, 100, 5);

      expect(range.segments).toHaveLength(0);
    });

    it("should handle count larger than remaining segments", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const totalSegments = story.segments.length;
      const range = getSegmentRange(story, totalSegments - 2, 10);

      expect(range.segments).toHaveLength(2);
    });

    it("should update speakers list for range", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      // First 2 segments are both NARRATOR
      const range = getSegmentRange(story, 0, 2);

      expect(range.speakers).toEqual(["NARRATOR"]);
    });

    it("should update total characters for range", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const range = getSegmentRange(story, 0, 2);

      const expectedChars = range.segments.reduce((sum, s) => sum + s.text.length, 0);
      expect(range.totalCharacters).toBe(expectedChars);
    });
  });

  describe("segment ID generation", () => {
    it("should generate unique IDs for each segment", () => {
      const story = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const ids = story.segments.map((s) => s.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should generate consistent IDs for same content", () => {
      const story1 = parseContent(BRACKET_FORMAT_STORY, "test.txt");
      const story2 = parseContent(BRACKET_FORMAT_STORY, "test.txt");

      story1.segments.forEach((segment, index) => {
        expect(segment.id).toBe(story2.segments[index].id);
      });
    });

    it("should generate different IDs for different content", () => {
      const story1 = parseContent("[NARRATOR] Hello world!", "test.txt");
      const story2 = parseContent("[NARRATOR] Hello universe!", "test.txt");

      expect(story1.segments[0].id).not.toBe(story2.segments[0].id);
    });
  });
});
