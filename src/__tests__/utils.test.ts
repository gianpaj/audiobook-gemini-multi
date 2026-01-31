/**
 * Tests for the utils module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processWithConcurrency, type ProcessResult } from "../utils.js";

describe("utils", () => {
  describe("processWithConcurrency", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should process all items successfully", async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = async (item: number) => item * 2;

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results).toHaveLength(5);
      expect(results.every((r) => r.success)).toBe(true);
      expect(results.map((r) => r.result)).toEqual([2, 4, 6, 8, 10]);
    });

    it("should preserve order of results", async () => {
      const items = ["a", "b", "c", "d"];
      // Process with varying delays to test order preservation
      const processor = async (item: string, index: number) => {
        return `${item}-${index}`;
      };

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3]);
      expect(results.map((r) => r.item)).toEqual(["a", "b", "c", "d"]);
      expect(results.map((r) => r.result)).toEqual([
        "a-0",
        "b-1",
        "c-2",
        "d-3",
      ]);
    });

    it("should respect concurrency limit", async () => {
      const concurrentCalls: number[] = [];
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      const items = [1, 2, 3, 4, 5, 6, 7, 8];
      const processor = async (item: number) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        concurrentCalls.push(currentConcurrent);

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 100));

        currentConcurrent--;
        return item;
      };

      const resultsPromise = processWithConcurrency(items, processor, {
        concurrency: 3,
      });
      await vi.runAllTimersAsync();
      await resultsPromise;

      // Max concurrent should never exceed the limit
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it("should use default concurrency of 4", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const processor = async (item: number) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 50));
        currentConcurrent--;
        return item;
      };

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      await resultsPromise;

      expect(maxConcurrent).toBeLessThanOrEqual(4);
    });

    it("should handle errors gracefully", async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = async (item: number) => {
        if (item === 3) {
          throw new Error("Item 3 failed");
        }
        return item * 2;
      };

      const resultsPromise = processWithConcurrency(items, processor, {
        stopOnError: false,
      });
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results).toHaveLength(5);
      expect(results[0].success).toBe(true);
      expect(results[0].result).toBe(2);
      expect(results[2].success).toBe(false);
      expect(results[2].error).toBe("Item 3 failed");
      expect(results[4].success).toBe(true);
      expect(results[4].result).toBe(10);
    });

    it("should stop on first error when stopOnError is true", async () => {
      const processedItems: number[] = [];
      const items = [1, 2, 3, 4, 5];

      const processor = async (item: number) => {
        processedItems.push(item);
        // Small delay to allow items to queue up
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (item === 2) {
          throw new Error("Item 2 failed");
        }
        return item * 2;
      };

      const resultsPromise = processWithConcurrency(items, processor, {
        concurrency: 1, // Process one at a time to test stopOnError behavior
        stopOnError: true,
      });
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      // Should have stopped after encountering the error
      // Item 1 should succeed, item 2 should fail
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe("Item 2 failed");
    });

    it("should call onProgress callback for each completed item", async () => {
      const items = [1, 2, 3];
      const progressCalls: Array<{
        completed: number;
        total: number;
        result: ProcessResult<number, number>;
      }> = [];

      const processor = async (item: number) => item * 2;
      const onProgress = (
        completed: number,
        total: number,
        result: ProcessResult<number, number>,
      ) => {
        progressCalls.push({ completed, total, result });
      };

      const resultsPromise = processWithConcurrency(items, processor, {
        onProgress,
      });
      await vi.runAllTimersAsync();
      await resultsPromise;

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls.map((p) => p.total)).toEqual([3, 3, 3]);
      // Completed counts should increase
      const completedCounts = progressCalls.map((p) => p.completed).sort();
      expect(completedCounts).toEqual([1, 2, 3]);
    });

    it("should handle empty array", async () => {
      const items: number[] = [];
      const processor = async (item: number) => item * 2;

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results).toHaveLength(0);
    });

    it("should handle single item", async () => {
      const items = [42];
      const processor = async (item: number) => item * 2;

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].result).toBe(84);
      expect(results[0].item).toBe(42);
      expect(results[0].index).toBe(0);
    });

    it("should handle concurrency greater than items length", async () => {
      const items = [1, 2];
      const processor = async (item: number) => item * 2;

      const resultsPromise = processWithConcurrency(items, processor, {
        concurrency: 10,
      });
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("should handle async errors with Error objects", async () => {
      const items = [1];
      const processor = async (_item: number) => {
        throw new Error("Custom error message");
      };

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Custom error message");
    });

    it("should handle async errors with non-Error objects", async () => {
      const items = [1];
      const processor = async (_item: number): Promise<number> => {
        throw "String error";
      };

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("String error");
    });

    it("should process items in parallel when concurrency allows", async () => {
      const startTimes: number[] = [];

      vi.useRealTimers(); // Use real timers for this test

      const items = [1, 2, 3, 4];
      const processor = async (item: number) => {
        startTimes.push(Date.now());
        // Small delay to simulate work
        await new Promise((resolve) => setTimeout(resolve, 50));
        return item;
      };

      const results = await processWithConcurrency(items, processor, {
        concurrency: 4,
      });

      expect(results).toHaveLength(4);

      // With concurrency of 4, all items should start at roughly the same time
      // The difference between first and last start time should be small
      const timeDiff = Math.max(...startTimes) - Math.min(...startTimes);
      // Allow 30ms tolerance for test execution overhead
      expect(timeDiff).toBeLessThan(30);

      vi.useFakeTimers(); // Restore fake timers for cleanup
    });

    it("should work with complex object types", async () => {
      interface Task {
        id: string;
        value: number;
      }

      interface TaskResult {
        id: string;
        computed: number;
      }

      const items: Task[] = [
        { id: "a", value: 10 },
        { id: "b", value: 20 },
        { id: "c", value: 30 },
      ];

      const processor = async (task: Task): Promise<TaskResult> => {
        return {
          id: task.id,
          computed: task.value * 2,
        };
      };

      const resultsPromise = processWithConcurrency(items, processor);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      expect(results).toHaveLength(3);
      expect(results[0].result).toEqual({ id: "a", computed: 20 });
      expect(results[1].result).toEqual({ id: "b", computed: 40 });
      expect(results[2].result).toEqual({ id: "c", computed: 60 });
    });
  });
});
