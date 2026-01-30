/**
 * Main CLI interface for the audiobook generation system
 *
 * Commands:
 * - generate: Parse and generate full audiobook
 * - preview: Generate just first N segments for testing
 * - update-styles: Regenerate segments with changed style prompts
 * - clean: Clear cache and regenerated files
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import cliProgress from "cli-progress";
import { readFile, access, mkdir, unlink, readdir } from "fs/promises";
import { join, basename, extname } from "path";

import type {
  Config,
  ParsedStory,
  SegmentGenerationResult,
  AudiobookResult,
  GenerateOptions,
  PreviewOptions,
} from "./types.js";

import {
  parseFile,
  validateParsedStory,
  getStorySummary,
  getSegmentRange,
  filterBySpeaker,
} from "./parser.js";

import {
  loadConfig,
  loadOrCreateConfig,
  saveConfig,
  createConfigForSpeakers,
  getConfigSummary,
  hashConfig,
  DEFAULT_CONFIG,
} from "./config.js";

import {
  loadCacheManifest,
  saveCacheManifest,
  createEmptyManifest,
  verifyCachedSegment,
  updateCachedSegment,
  getSegmentsToGenerate,
  getCachedSegments,
  getSegmentsWithStyleChanges,
  clearCache,
  getCachedSegmentPath,
  getCacheSummary,
  getCacheStats,
  ensureCacheDir,
  hashText,
} from "./cache.js";

import {
  createTTSProvider,
  generateSegmentAudio,
  formatDuration,
  type TTSProvider,
} from "./tts-provider.js";

import {
  convertToStoryFormat,
  getConversionPrompt,
  validateConvertedContent,
  type ConversionOptions,
} from "./converter.js";

import {
  stitchAudioFiles,
  saveManifest,
  getStitchSummary,
  formatFileSize,
  estimateCost,
  estimateAudioDuration,
  type AudioFileInfo,
} from "./audio.js";

// ============================================================================
// CLI Utilities
// ============================================================================

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
 * Get default config path
 */
function getDefaultConfigPath(): string {
  return "./config.json";
}

/**
 * Get default output directory
 */
function getDefaultOutputDir(): string {
  return "./output";
}

/**
 * Print error and exit
 */
function exitWithError(message: string): never {
  console.error(chalk.red(`\n✖ Error: ${message}\n`));
  process.exit(1);
}

/**
 * Print warning
 */
function printWarning(message: string): void {
  console.warn(chalk.yellow(`⚠ Warning: ${message}`));
}

/**
 * Print success
 */
function printSuccess(message: string): void {
  console.log(chalk.green(`✔ ${message}`));
}

/**
 * Print info
 */
function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

// ============================================================================
// Generation Logic
// ============================================================================

/**
 * Generate audiobook from a story file
 */
async function generateAudiobook(
  storyPath: string,
  config: Config,
  outputDir: string,
  options: {
    force?: boolean;
    verbose?: boolean;
    dryRun?: boolean;
    maxSegments?: number;
    startFrom?: number;
    speakers?: string[];
    timestamp?: string;
  } = {},
): Promise<AudiobookResult> {
  const spinner = ora();
  const errors: string[] = [];
  const startTime = Date.now();

  // Parse the story
  spinner.start("Parsing story file...");
  let story: ParsedStory;
  try {
    story = await parseFile(storyPath);
  } catch (error) {
    spinner.fail("Failed to parse story file");
    throw error;
  }
  spinner.succeed(
    `Parsed story: ${story.segments.length} segments, ${story.speakers.length} speakers`,
  );

  // Validate the story
  const validation = validateParsedStory(story);
  if (!validation.valid) {
    exitWithError(`Story validation failed:\n${validation.errors.join("\n")}`);
  }
  if (validation.warnings.length > 0) {
    for (const warning of validation.warnings) {
      printWarning(warning);
    }
  }

  // Apply filters if provided
  let segmentsToProcess = story.segments;
  if (options.speakers && options.speakers.length > 0) {
    story = filterBySpeaker(story, options.speakers);
    segmentsToProcess = story.segments;
    printInfo(`Filtered to speakers: ${options.speakers.join(", ")}`);
  }
  if (options.startFrom !== undefined || options.maxSegments !== undefined) {
    const start = options.startFrom || 0;
    const count = options.maxSegments || segmentsToProcess.length;
    story = getSegmentRange(story, start, count);
    segmentsToProcess = story.segments;
    printInfo(
      `Processing segments ${start} to ${start + segmentsToProcess.length - 1}`,
    );
  }

  if (options.verbose) {
    console.log("\n" + getStorySummary(story) + "\n");
  }

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  await ensureCacheDir(outputDir);

  // Load or create cache manifest
  const storyHash = hashText(await readFile(storyPath, "utf-8"));
  const configHash = hashConfig(config);
  let manifest = await loadCacheManifest(outputDir);

  if (
    options.force ||
    !manifest ||
    manifest.storyHash !== storyHash ||
    manifest.configHash !== configHash
  ) {
    if (manifest && options.verbose) {
      if (manifest.storyHash !== storyHash) {
        printInfo("Story file changed, cache may be partially invalidated");
      }
      if (manifest.configHash !== configHash) {
        printInfo("Configuration changed, cache may be partially invalidated");
      }
    }
    manifest = createEmptyManifest(storyPath, storyHash, configHash);
  }

  // Determine which segments need generation
  const segmentsToGenerate = options.force
    ? segmentsToProcess
    : getSegmentsToGenerate(manifest, segmentsToProcess, config);

  const cachedSegmentsInfo = options.force
    ? []
    : getCachedSegments(manifest, segmentsToProcess, config);

  if (options.verbose) {
    console.log(getCacheSummary(manifest, segmentsToProcess.length));
    printInfo(
      `Segments to generate: ${segmentsToGenerate.length}, from cache: ${cachedSegmentsInfo.length}`,
    );
  }

  // Dry run - just show what would be done
  if (options.dryRun) {
    console.log("\n" + chalk.cyan("=== Dry Run ==="));
    console.log(`Would generate ${segmentsToGenerate.length} segments`);
    console.log(`Would use ${cachedSegmentsInfo.length} cached segments`);
    console.log(
      `Estimated audio duration: ${formatDuration(estimateAudioDuration(story.totalCharacters))}`,
    );
    console.log(
      `Estimated cost: $${estimateCost(story.totalCharacters).toFixed(4)}`,
    );

    return {
      outputPath: "",
      manifestPath: "",
      stats: {
        totalSegments: segmentsToProcess.length,
        generatedSegments: 0,
        cachedSegments: cachedSegmentsInfo.length,
        failedSegments: 0,
        totalTimeMs: 0,
        totalAudioDurationMs: 0,
      },
      segmentResults: [],
      success: true,
      errors: [],
    };
  }

  // Initialize TTS provider
  spinner.start("Initializing TTS provider...");
  let provider: TTSProvider;
  try {
    provider = createTTSProvider(config);
    await provider.initialize();
  } catch (error) {
    spinner.fail("Failed to initialize TTS provider");
    throw error;
  }
  spinner.succeed(
    `TTS provider initialized: ${config.provider.name} (${config.provider.model})`,
  );

  // Generate segments with progress bar
  const segmentResults: SegmentGenerationResult[] = [];
  let totalAudioDurationMs = 0;

  if (segmentsToGenerate.length > 0) {
    console.log("\n" + chalk.cyan("Generating audio segments..."));

    const progressBar = new cliProgress.SingleBar(
      {
        format:
          "Progress |" +
          chalk.cyan("{bar}") +
          "| {percentage}% | {value}/{total} segments | ETA: {eta}s",
        barCompleteChar: "█",
        barIncompleteChar: "░",
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic,
    );

    progressBar.start(segmentsToGenerate.length, 0);

    for (let i = 0; i < segmentsToGenerate.length; i++) {
      const segment = segmentsToGenerate[i];
      const segmentStartTime = Date.now();

      const outputPath = getCachedSegmentPath(
        outputDir,
        segment.id,
        config.audio.format,
      );

      try {
        const response = await generateSegmentAudio(
          provider,
          segment,
          config,
          outputPath,
        );

        if (response.success && response.audioPath) {
          // Update cache manifest
          manifest = updateCachedSegment(manifest, segment, config, {
            audioPath: response.audioPath,
            durationMs: response.durationMs || 0,
            fileSize: response.fileSize || 0,
            success: true,
          });

          totalAudioDurationMs += response.durationMs || 0;

          segmentResults.push({
            segment,
            success: true,
            audioPath: response.audioPath,
            durationMs: response.durationMs,
            fileSize: response.fileSize,
            fromCache: false,
            timeTakenMs: Date.now() - segmentStartTime,
          });
        } else {
          errors.push(`Segment ${segment.id}: ${response.error}`);
          segmentResults.push({
            segment,
            success: false,
            fromCache: false,
            error: response.error,
            timeTakenMs: Date.now() - segmentStartTime,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Segment ${segment.id}: ${errorMsg}`);
        segmentResults.push({
          segment,
          success: false,
          fromCache: false,
          error: errorMsg,
          timeTakenMs: Date.now() - segmentStartTime,
        });
      }

      progressBar.update(i + 1);

      // Save manifest periodically (every 10 segments)
      if ((i + 1) % 10 === 0) {
        await saveCacheManifest(outputDir, manifest);
      }
    }

    progressBar.stop();
  }

  // Add cached segments to results
  for (const { segment, cached } of cachedSegmentsInfo) {
    // Verify cached file still exists
    const exists = await verifyCachedSegment(outputDir, cached);
    if (exists) {
      segmentResults.push({
        segment,
        success: true,
        audioPath: cached.audioPath,
        durationMs: cached.durationMs,
        fileSize: cached.fileSize,
        fromCache: true,
        timeTakenMs: 0,
      });
      totalAudioDurationMs += cached.durationMs;
    } else {
      // Cached file missing, would need to regenerate
      printWarning(`Cached file missing for segment ${segment.id}`);
    }
  }

  // Save final manifest
  await saveCacheManifest(outputDir, manifest);

  // Sort results by segment index
  segmentResults.sort((a, b) => a.segment.index - b.segment.index);

  // Check if all segments succeeded
  const successfulResults = segmentResults.filter((r) => r.success);
  const failedCount = segmentResults.length - successfulResults.length;

  if (failedCount > 0) {
    printWarning(`${failedCount} segments failed to generate`);
  }

  if (successfulResults.length === 0) {
    exitWithError("No segments were successfully generated");
  }

  // Stitch audio files together
  spinner.start("Stitching audio files...");

  const timestampSuffix = options.timestamp ? `_${options.timestamp}` : "";
  const outputFileName = `${basename(storyPath, extname(storyPath))}${timestampSuffix}_audiobook.wav`;
  const outputPath = join(outputDir, outputFileName);

  const audioFiles: AudioFileInfo[] = successfulResults.map((r) => ({
    path: r.audioPath!,
    index: r.segment.index,
    speaker: r.segment.speaker,
    text: r.segment.text,
    durationMs: r.durationMs,
  }));

  try {
    const stitchResult = await stitchAudioFiles(audioFiles, outputPath, {
      silencePaddingMs: config.audio.silencePadding,
      sampleRate: config.audio.sampleRate,
      bitsPerSample: config.audio.bitDepth,
      title: basename(storyPath, extname(storyPath)),
      sourceFile: storyPath,
    });

    // Save manifest
    const manifestPath = join(
      outputDir,
      `${basename(storyPath, extname(storyPath))}${timestampSuffix}_manifest.json`,
    );
    await saveManifest(stitchResult.manifest, manifestPath);

    spinner.succeed("Audio files stitched successfully");

    // Print summary
    console.log("\n" + getStitchSummary(stitchResult));

    const totalTimeMs = Date.now() - startTime;

    return {
      outputPath: stitchResult.outputPath,
      manifestPath,
      stats: {
        totalSegments: segmentsToProcess.length,
        generatedSegments: segmentsToGenerate.length,
        cachedSegments: cachedSegmentsInfo.length,
        failedSegments: failedCount,
        totalTimeMs,
        totalAudioDurationMs: stitchResult.totalDurationMs,
      },
      segmentResults,
      success: failedCount === 0,
      errors,
    };
  } catch (error) {
    spinner.fail("Failed to stitch audio files");
    throw error;
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

const program = new Command();

program
  .name("audiobook")
  .description("Generate audiobooks from story scripts using TTS")
  .version("1.0.0");

/**
 * Setup command - initialize project with config
 */
program
  .command("setup")
  .description("Initialize project with configuration file")
  .option("-o, --output <path>", "Output directory", getDefaultOutputDir())
  .option("-f, --force", "Overwrite existing config", false)
  .action(async (options) => {
    const configPath = getDefaultConfigPath();

    if ((await fileExists(configPath)) && !options.force) {
      exitWithError(
        `Config file already exists: ${configPath}\nUse --force to overwrite`,
      );
    }

    const config = { ...DEFAULT_CONFIG };
    await saveConfig(configPath, config);
    printSuccess(`Created config file: ${configPath}`);

    // Create output directory
    await mkdir(options.output, { recursive: true });
    printSuccess(`Created output directory: ${options.output}`);

    console.log("\nNext steps:");
    console.log("1. Edit config.json to configure voices");
    console.log("2. Set GEMINI_API_KEY environment variable");
    console.log("3. Run: npm run generate <story.txt>");
  });

/**
 * Init command - create config from story file
 */
program
  .command("init <storyFile>")
  .description("Create config file based on speakers in story")
  .option("-o, --output <path>", "Config output path", getDefaultConfigPath())
  .option("-f, --force", "Overwrite existing config", false)
  .action(async (storyFile: string, options) => {
    if ((await fileExists(options.output)) && !options.force) {
      exitWithError(
        `Config file already exists: ${options.output}\nUse --force to overwrite`,
      );
    }

    const spinner = ora("Parsing story file...").start();
    try {
      const story = await parseFile(storyFile);
      spinner.succeed(
        `Found ${story.speakers.length} speakers: ${story.speakers.join(", ")}`,
      );

      const config = createConfigForSpeakers(story.speakers);
      await saveConfig(options.output, config);
      printSuccess(`Created config file: ${options.output}`);

      console.log("\nVoice assignments:");
      for (const voice of config.voices) {
        console.log(
          `  ${voice.name}: ${voice.voiceName} - "${voice.stylePrompt}"`,
        );
      }

      console.log("\nEdit the config file to customize voices, then run:");
      console.log(`  npm run generate ${storyFile}`);
    } catch (error) {
      spinner.fail("Failed to parse story file");
      throw error;
    }
  });

/**
 * Generate command - full audiobook generation
 */
program
  .command("generate <storyFile>")
  .description("Generate audiobook from story file")
  .option("-c, --config <path>", "Path to config file", getDefaultConfigPath())
  .option("-o, --output <path>", "Output directory", getDefaultOutputDir())
  .option("-f, --force", "Force regeneration (ignore cache)", false)
  .option("-v, --verbose", "Verbose output", false)
  .option("-d, --dry-run", "Show what would be done without generating", false)
  .action(async (storyFile: string, options: GenerateOptions) => {
    // Check story file exists
    if (!(await fileExists(storyFile))) {
      exitWithError(`Story file not found: ${storyFile}`);
    }

    // Load config
    let config: Config;
    try {
      config = await loadOrCreateConfig(
        options.config || getDefaultConfigPath(),
      );
    } catch (error) {
      exitWithError(
        `Failed to load config: ${error instanceof Error ? error.message : error}`,
      );
    }

    if (options.verbose) {
      console.log("\n" + getConfigSummary(config) + "\n");
    }

    // Generate timestamp for unique output filenames
    const timestamp = Date.now().toString();

    try {
      const result = await generateAudiobook(
        storyFile,
        config,
        options.output || getDefaultOutputDir(),
        {
          force: options.force,
          verbose: options.verbose,
          dryRun: options.dryRun,
          timestamp,
        },
      );

      if (!options.dryRun) {
        console.log("\n" + chalk.green("✔ Audiobook generation complete!"));
        console.log(
          `\nTotal time: ${formatDuration(result.stats.totalTimeMs)}`,
        );

        if (result.errors.length > 0) {
          console.log(chalk.yellow("\nWarnings:"));
          for (const error of result.errors) {
            console.log(chalk.yellow(`  - ${error}`));
          }
        }
      }
    } catch (error) {
      exitWithError(
        `Generation failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  });

/**
 * Preview command - generate subset of segments
 */
program
  .command("preview <storyFile>")
  .description("Generate preview of first N segments")
  .option("-c, --config <path>", "Path to config file", getDefaultConfigPath())
  .option("-o, --output <path>", "Output directory", getDefaultOutputDir())
  .option("-n, --segments <number>", "Number of segments to preview", "5")
  .option("-s, --start <number>", "Start from segment index", "0")
  .option("--speaker <name>", "Preview only specific speaker")
  .option("-f, --force", "Force regeneration", false)
  .option("-v, --verbose", "Verbose output", false)
  .action(async (storyFile: string, options: PreviewOptions) => {
    if (!(await fileExists(storyFile))) {
      exitWithError(`Story file not found: ${storyFile}`);
    }

    let config: Config;
    try {
      config = await loadOrCreateConfig(
        options.config || getDefaultConfigPath(),
      );
    } catch (error) {
      exitWithError(
        `Failed to load config: ${error instanceof Error ? error.message : error}`,
      );
    }

    const maxSegments = parseInt(String(options.segments || "5"), 10);
    const startFrom = parseInt(String(options.startFrom || "0"), 10);
    const speakers = options.speaker ? [options.speaker] : undefined;

    console.log(
      chalk.cyan(
        `\nGenerating preview: ${maxSegments} segments starting from ${startFrom}`,
      ),
    );

    // Generate timestamp for unique output filenames
    const timestamp = Date.now().toString();

    try {
      await generateAudiobook(
        storyFile,
        config,
        options.output || getDefaultOutputDir(),
        {
          force: options.force,
          verbose: options.verbose,
          maxSegments,
          startFrom,
          speakers,
          timestamp,
        },
      );

      printSuccess("Preview generation complete!");
    } catch (error) {
      exitWithError(
        `Preview generation failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  });

/**
 * Update-styles command - regenerate with new style prompts
 */
program
  .command("update-styles")
  .description("Regenerate segments with changed style prompts")
  .argument("<storyFile>", "Story file path")
  .option("-c, --config <path>", "Path to config file", getDefaultConfigPath())
  .option("-o, --output <path>", "Output directory", getDefaultOutputDir())
  .option(
    "-s, --speakers <names>",
    "Specific speakers to update (comma-separated)",
  )
  .option("-f, --force", "Force update even if unchanged", false)
  .option("-v, --verbose", "Verbose output", false)
  .action(
    async (
      storyFile: string,
      options: {
        config?: string;
        output?: string;
        speakers?: string;
        force?: boolean;
        verbose?: boolean;
      },
    ) => {
      if (!(await fileExists(storyFile))) {
        exitWithError(`Story file not found: ${storyFile}`);
      }

      let config: Config;
      try {
        config = await loadConfig(options.config || getDefaultConfigPath());
      } catch (error) {
        exitWithError(
          `Failed to load config: ${error instanceof Error ? error.message : error}`,
        );
      }

      const speakers = options.speakers
        ? (options.speakers as unknown as string)
            .split(",")
            .map((s) => s.trim())
        : undefined;

      console.log(chalk.cyan("\nChecking for style changes..."));

      // Parse story
      const story = await parseFile(storyFile);
      const outputDir = options.output || getDefaultOutputDir();

      // Load cache manifest
      const manifest = await loadCacheManifest(outputDir);
      if (!manifest) {
        printInfo("No cache found. Running full generation...");
        const timestamp = Date.now().toString();
        await generateAudiobook(storyFile, config, outputDir, {
          verbose: options.verbose,
          timestamp,
        });
        return;
      }

      // Find segments with style changes
      const changedSegments = getSegmentsWithStyleChanges(
        manifest,
        story.segments,
        config,
        speakers,
      );

      if (changedSegments.length === 0 && !options.force) {
        printSuccess("No style changes detected. Nothing to update.");
        return;
      }

      console.log(
        `Found ${changedSegments.length} segments to update${speakers ? ` for speakers: ${speakers.join(", ")}` : ""}`,
      );

      // Regenerate changed segments
      const timestamp = Date.now().toString();
      await generateAudiobook(storyFile, config, outputDir, {
        force: true, // Force regeneration of all segments
        verbose: options.verbose,
        timestamp,
      });

      printSuccess("Style update complete!");
    },
  );

/**
 * Clean command - clear cache and output files
 */
program
  .command("clean")
  .description("Clear cache and generated files")
  .option("-o, --output <path>", "Output directory", getDefaultOutputDir())
  .option("--cache-only", "Only clear cache, keep generated audiobooks", false)
  .option("--output-only", "Only clear output files, keep cache", false)
  .option("-f, --force", "Don't ask for confirmation", false)
  .action(
    async (options: {
      output?: string;
      cacheOnly?: boolean;
      outputOnly?: boolean;
      force?: boolean;
    }) => {
      const outputDir = options.output || getDefaultOutputDir();

      if (!(await fileExists(outputDir))) {
        printInfo("Output directory does not exist. Nothing to clean.");
        return;
      }

      if (!options.force) {
        console.log(chalk.yellow("\nThis will delete:"));
        if (!options.outputOnly) {
          console.log("  - Cache directory and all cached segments");
        }
        if (!options.cacheOnly) {
          console.log("  - Generated audiobook files");
          console.log("  - Manifest files");
        }
        console.log("\nUse --force to skip this confirmation.");
        return;
      }

      const spinner = ora("Cleaning...").start();

      try {
        if (!options.outputOnly) {
          // Clear cache
          await clearCache(outputDir);
          spinner.text = "Cleared cache...";
        }

        if (!options.cacheOnly) {
          // Clear output files (WAV and JSON files in output dir)
          const files = await readdir(outputDir);
          for (const file of files) {
            if (file.endsWith(".wav") || file.endsWith("_manifest.json")) {
              await unlink(join(outputDir, file));
            }
          }
        }

        spinner.succeed("Clean complete!");
      } catch (error) {
        spinner.fail("Clean failed");
        throw error;
      }
    },
  );

/**
 * Info command - show project information
 */
program
  .command("info")
  .description("Show project and cache information")
  .argument("[storyFile]", "Story file path (optional)")
  .option("-c, --config <path>", "Path to config file", getDefaultConfigPath())
  .option("-o, --output <path>", "Output directory", getDefaultOutputDir())
  .action(async (storyFile: string | undefined, options) => {
    // Show config info
    console.log(chalk.cyan("\n=== Configuration ==="));
    if (await fileExists(options.config)) {
      try {
        const config = await loadConfig(options.config);
        console.log(getConfigSummary(config));
      } catch (error) {
        console.log(chalk.red(`Failed to load config: ${error}`));
      }
    } else {
      console.log("No config file found. Run 'setup' or 'init' to create one.");
    }

    // Show story info if provided
    if (storyFile) {
      console.log(chalk.cyan("\n=== Story ==="));
      if (await fileExists(storyFile)) {
        const story = await parseFile(storyFile);
        console.log(getStorySummary(story));

        const validation = validateParsedStory(story);
        if (validation.warnings.length > 0) {
          console.log(chalk.yellow("\nWarnings:"));
          for (const warning of validation.warnings) {
            console.log(chalk.yellow(`  - ${warning}`));
          }
        }
      } else {
        console.log(`Story file not found: ${storyFile}`);
      }
    }

    // Show cache info
    console.log(chalk.cyan("\n=== Cache ==="));
    const outputDir = options.output || getDefaultOutputDir();
    const manifest = await loadCacheManifest(outputDir);
    if (manifest) {
      const stats = getCacheStats(manifest);
      console.log(`Cached segments: ${stats.cachedCount}`);
      console.log(
        `Total cached duration: ${formatDuration(stats.totalDurationMs)}`,
      );
      console.log(`Cache size: ${formatFileSize(stats.totalSizeBytes)}`);
      if (stats.newestEntry) {
        console.log(`Last updated: ${stats.newestEntry}`);
      }
    } else {
      console.log("No cache found.");
    }
  });

/**
 * Convert command - convert plain text to speaker-tagged format
 */
program
  .command("convert <inputFile>")
  .description(
    "Convert plain text/prose to speaker-tagged story format using AI",
  )
  .option(
    "-o, --output <path>",
    "Output file path (default: input_converted.txt)",
  )
  .option("-f, --format <type>", "Output format: bracket or colon", "bracket")
  .option(
    "-s, --speakers <names>",
    "Comma-separated list of speaker names to use",
  )
  .option("--no-narrator", "Exclude NARRATOR tag (dialogue only)")
  .option("--prompt-only", "Show the conversion prompt without calling the API")
  .option("-v, --verbose", "Verbose output", false)
  .action(async (inputFile: string, options) => {
    const spinner = ora("Reading input file...").start();

    try {
      // Check if input file exists
      if (!(await fileExists(inputFile))) {
        spinner.fail(`Input file not found: ${inputFile}`);
        process.exit(1);
      }

      // Read input file
      const inputText = await readFile(inputFile, "utf-8");
      spinner.succeed(`Read ${inputText.length} characters from ${inputFile}`);

      // Parse speakers if provided
      const speakers = options.speakers
        ? options.speakers.split(",").map((s: string) => s.trim().toUpperCase())
        : undefined;

      const conversionOptions: ConversionOptions = {
        format: options.format as "bracket" | "colon",
        speakers,
        includeNarrator: options.narrator !== false,
      };

      // If prompt-only, just show the prompt
      if (options.promptOnly) {
        const { systemPrompt, userPrompt } = getConversionPrompt(
          inputText,
          conversionOptions,
        );

        console.log(chalk.cyan("\n=== System Prompt ===\n"));
        console.log(systemPrompt);
        console.log(chalk.cyan("\n=== User Prompt ===\n"));
        console.log(userPrompt);
        return;
      }

      // Convert the text
      spinner.start("Converting text to story format...");
      const result = await convertToStoryFormat(inputText, conversionOptions);

      if (!result.success) {
        spinner.fail(`Conversion failed: ${result.error}`);
        process.exit(1);
      }

      spinner.succeed("Conversion complete!");

      // Validate the result
      const validation = validateConvertedContent(
        result.content!,
        options.format,
      );
      if (!validation.valid && options.verbose) {
        console.log(
          chalk.yellow("\nWarning: Some formatting issues detected:"),
        );
        for (const error of validation.errors.slice(0, 5)) {
          console.log(chalk.yellow(`  - ${error}`));
        }
        if (validation.errors.length > 5) {
          console.log(
            chalk.yellow(`  ... and ${validation.errors.length - 5} more`),
          );
        }
      }

      // Determine output path
      const outputPath =
        options.output || inputFile.replace(/\.[^.]+$/, "_converted.txt");

      // Write output file
      const { writeFile: writeFileFs } = await import("fs/promises");
      await writeFileFs(outputPath, result.content!, "utf-8");

      // Show summary
      console.log(chalk.cyan("\n=== Conversion Summary ===\n"));
      console.log(`  Input file:  ${inputFile}`);
      console.log(`  Output file: ${outputPath}`);
      console.log(`  Model:       ${options.model}`);
      console.log(`  Format:      ${options.format}`);
      console.log(`  Segments:    ${validation.lineCount}`);
      console.log(
        `  Speakers:    ${result.speakers?.join(", ") || "none detected"}`,
      );

      if (result.usage) {
        console.log(
          `  Tokens:      ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`,
        );
      }

      console.log(chalk.green("\n✓ Conversion complete!"));
      console.log(`\nNext steps:`);
      console.log(`  1. Review the converted file: ${outputPath}`);
      console.log(`  2. Initialize config: pnpm run init ${outputPath}`);
      console.log(`  3. Generate audiobook: pnpm run generate ${outputPath}`);
    } catch (error) {
      spinner.fail("Conversion failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      exitWithError(errorMessage);
    }
  });

/**
 * Voices command - list available voices
 */
program
  .command("voices")
  .description("List available TTS voices")
  .action(() => {
    console.log(chalk.cyan("\n=== Available Gemini Voices ===\n"));
    const voices = [
      "Zephyr - Balanced, clear narrator voice",
      "Puck - Light, playful voice",
      "Charon - Deep, authoritative voice",
      "Kore - Warm, friendly female voice",
      "Fenrir - Strong, dramatic voice",
      "Leda - Soft, gentle voice",
      "Orus - Mature, wise voice",
      "Aoede - Musical, expressive voice",
      "Callirrhoe - Clear, articulate voice",
      "Autonoe - Energetic, youthful voice",
      "Enceladus - Powerful, resonant voice",
      "Iapetus - Deep, thoughtful voice",
      "Umbriel - Mysterious, atmospheric voice",
      "Algenib - Bright, engaging voice",
    ];

    for (const voice of voices) {
      console.log(`  • ${voice}`);
    }

    console.log(
      "\nUse these voice names in your config.json 'voiceName' field.",
    );
  });

// Parse arguments and run
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
