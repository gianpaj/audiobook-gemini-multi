# AGENTS.md - AI Agent Guidelines for Audiobook Generator

## Project Overview

This is a TypeScript CLI tool for generating audiobooks from story scripts using Google's Gemini TTS API with multi-speaker support.

## Project Structure

```text
audiobook-gemini-multi/
├── src/
│   ├── cli.ts           # Main CLI interface with all commands
│   ├── parser.ts        # Story file parsing (bracket/colon format)
│   ├── config.ts        # Configuration loading and validation
│   ├── tts-provider.ts  # Gemini TTS API integration
│   ├── audio.ts         # Audio stitching and WAV processing
│   ├── cache.ts         # Caching and manifest management
│   ├── converter.ts     # LLM-based text to story format conversion
│   ├── utils.ts         # Utility functions (debug logging, etc.)
│   ├── types.ts         # TypeScript type definitions
│   ├── index.ts         # Module exports
│   ├── fixtures/        # Test fixtures
│   └── __tests__/       # Vitest test files
├── output/              # Generated audiobooks (gitignored)
├── examples/            # Example story files
├── config.json          # User configuration
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Key Commands

- `pnpm run generate <storyFile>` - Generate full audiobook
- `pnpm run generate <storyFile> -p 8` - Generate with 8 parallel workers
- `pnpm run preview <storyFile> -n 5` - Generate preview (first N segments)
- `pnpm run analyze <inputFile>` - Analyze text to identify characters and genders
- `pnpm run convert <inputFile>` - Convert plain text to story format using AI
- `pnpm run init <storyFile>` - Create config from story speakers
- `pnpm run clean` - Clear cache and output files
- `pnpm run test` - Run Vitest tests
- `pnpm run typecheck` - Run TypeScript type checking

### Analyze Command

The `analyze` command uses AI to identify characters in a story and determine their likely gender:

```bash
pnpm run analyze story.txt
```

Output includes:

- Character names (in UPPERCASE, suitable for speaker tags)
- Gender classification: `female`, `male`, or `neutral`
- Confidence level: `high`, `medium`, or `low`
- Brief character descriptions when detectable

Options:

- `-m, --model <model>` - Model to use in `provider:model` format (e.g., `gemini:gemini-3-pro-preview`, `grok:grok-4-1-fast-reasoning`)
- `--no-narrator` - Exclude NARRATOR from analysis
- `--suggest-voices` - Suggest Gemini voices based on character genders
- `--update-config [path]` - Update config file with suggested voices (default: `./config.json`)
- `--json` - Output results as JSON
- `--prompt-only` - Show the AI prompt without calling the API
- `-v, --verbose` - Show token usage and model details

Examples:

```bash
# Use default (grok:grok-4-1-fast-reasoning)
pnpm run analyze story.txt

# Use Grok (xAI) provider
pnpm run analyze story.txt -m grok:grok-4-1-fast-reasoning

# Use specific Gemini model
pnpm run analyze story.txt -m gemini:gemini-3-pro-preview

# Model names starting with provider name auto-detect provider
pnpm run analyze story.txt -m grok-4-1-fast-reasoning

# Suggest voices based on character genders
pnpm run analyze story.txt --suggest-voices

# Analyze and automatically update config.json with voice suggestions
pnpm run analyze story.txt --update-config

# Update a specific config file with voice suggestions
pnpm run analyze story.txt --update-config ./my-config.json
```

Supported providers:

- `gemini` - Google Gemini (default: `gemini-3-pro-preview`)
- `grok` - xAI Grok (default: `grok-4-1-fast-reasoning`)

The output includes a ready-to-use speaker list for the convert command:

```bash
pnpm run convert story.txt -s "NARRATOR,ALICE,BOB"
```

### Voice Suggestions

When using `--suggest-voices`, the analyze command suggests appropriate Gemini voices based on each character's detected gender:

- Female characters → Female voices (Zephyr, Kore, Leda, Aoede, Sulafat, etc.)
- Male characters → Male voices (Puck, Charon, Fenrir, Orus, Iapetus, etc.)
- Neutral characters → Neutral voices (Pulcherrima, Achird, Vindemiatrix)

The voice data is sourced from `gemini_voices.csv` which contains all 30 Gemini voices with their style, pitch, and gender attributes.

Example output with `--suggest-voices`:

```
=== Voice Suggestions ===

Female Characters:
  ALICE → Zephyr (Bright, Higher pitch)
  MARY → Kore (Firm, Middle pitch)

Male Characters:
  BOB → Puck (Upbeat, Middle pitch)

Neutral Characters:
  NARRATOR → Pulcherrima (Forward, Middle pitch)
```

When using `--update-config`, the suggested voices are automatically written to your config file with appropriate `voiceName` and `stylePrompt` values, ready for audiobook generation.

### Parallel Processing

Segment generation now runs in parallel for faster audiobook creation:

- Default concurrency: 4 parallel segment generations
- Use `-p <number>` or `--concurrency <number>` to adjust
- Example: `pnpm run generate story.txt -p 8` for 8 parallel workers
- The rate limiter in the TTS provider still respects API limits
- Manifest is saved periodically (every 10 completions) to preserve progress

## Important Notes

### CLI Argument Passing

When passing arguments to pnpm scripts, do NOT use `--` before the arguments:

```bash
# CORRECT:
pnpm run preview story.txt -n 5 --force

# INCORRECT (-- gets passed literally):
pnpm run preview story.txt -- -n 5 --force
```

### Story Format

The tool expects stories in speaker-tagged format:

```text
[NARRATOR] Once upon a time...
[ALICE] Hello there!
```

or

```text
NARRATOR: Once upon a time...
ALICE: Hello there!
```

### Environment Variables

- `GEMINI_API_KEY` - Required for TTS generation, text conversion, and analyze command (with Gemini provider)
- `XAI_API_KEY` - Required for analyze command when using Grok provider
- `TTS_DEBUG_LOG` - Optional path to write debug logs to a file (legacy, for backwards compatibility)

### Debug Logging

Debug logs are automatically written to `{outputDir}/.audiobook-cache/{storyHash}/debug.log` inside each story's cache folder. This includes:

- TTS request details (voice, seed, text prompt)
- API response information
- Retry attempts with seed increments

You can also set `TTS_DEBUG_LOG` environment variable to write logs to an additional file.

### Testing

- All tests use Vitest with mocked APIs
- The `@google/genai` module is mocked in tests for TTS provider
- The `@ai-sdk/google` and `@ai-sdk/xai` modules are mocked in `src/__tests__/analyzer.test.ts`
- When adding new imports from `@google/genai`, update the mock in `src/__tests__/tts-provider.test.ts`
- File system is mocked using `memfs`

### Common Issues

1. **Tests failing with "No export defined on mock"**: Add missing exports to the `vi.mock()` block in test files (e.g., `@google/genai` for TTS, `@ai-sdk/google` for analyzer)

2. **`maxRetries: 0` not working**: Use nullish coalescing (`??`) not logical OR (`||`) for numeric options that can be 0

3. **Progress bar corrupting output**: Use `console.error()` or `process.stderr.write()` for debug output during generation

4. **Cached segments used when `--force` specified**: Ensure the force flag is properly passed through the command chain

### Code Conventions

- Use TypeScript strict mode
- Export types separately from implementations
- Use async/await for all async operations
- Handle errors with try/catch and return error objects rather than throwing
- Use `FinishReason.STOP` to check for successful API responses
- Check for `blockReason` in API responses for content filtering

### API Response Handling

Always check Gemini API responses for:

1. `blockReason` - Content was blocked by safety filters
2. `finishReason !== FinishReason.STOP` - Generation incomplete (MAX_TOKENS, SAFETY, OTHER, etc.)

### Automatic Seed Retry for "OTHER" and Transient Errors

When Gemini TTS returns `finishReason: OTHER` or encounters transient network errors, the system automatically retries with an incremented seed:

- Original attempt uses seed `N`
- Retry 1 uses seed `N + 1`
- Retry 2 uses seed `N + 2`
- Retry 3 uses seed `N + 3`
- After 4 total attempts, returns the error

Transient errors that trigger seed retry include:

- `fetch failed` - Network request failures
- `network` - General network errors
- `ECONNRESET` - Connection reset
- `ETIMEDOUT` - Connection timeout
- `socket` - Socket errors
- `500` - Internal server errors

A warning message is printed to stderr (including segment ID when available):

```
⚠️  Generation failed with OTHER [seg_0026_8ef0dbfd], retrying with seed 101 (attempt 2/4)
⚠️  Generation failed with transient error [seg_0026_8ef0dbfd], retrying with seed 102 (attempt 3/4)
```

For transient errors, a 2-second delay is added before retrying.

This behavior is implemented in both `generateAudio` and `generateMultiSpeaker` methods in `tts-provider.ts`.

### Automatic Retry for Excessive Audio Duration

Sometimes the TTS model generates unexpectedly long audio for short text (e.g., style directives like `<conflicted, breathless>` generating 29 seconds of audio when it should be under 10 seconds). The system automatically detects and retries these cases:

**Duration validation rules:**

- Expected duration is estimated based on text length (8-20 characters per second)
- Style directives like `<emotion>` are stripped when calculating expected duration
- Audio is considered excessive if it exceeds `max_expected * 3` or 10 seconds minimum tolerance
- **Style-only or very short texts (<10 chars after stripping directives) have a strict 5-second limit**
- Absolute maximum of 2 minutes per segment regardless of text length

**Retry behavior:**

- When excessive duration is detected, retries with incremented seed (same as OTHER errors)
- Up to 4 total attempts before accepting the result
- If still excessive after all retries, a warning is logged but the audio is kept

Example warning messages:

```
⚠️  Duration 29s exceeds 5s limit for short/style-only text (0 chars) [seg_0012_f425762d], retrying with seed 101 (attempt 2/4)
⚠️  Duration 45s exceeds expected max of 12s (text: 50 chars) [seg_0026_abc123], retrying with seed 102 (attempt 3/4)
```

This prevents garbage audio from:
- Style directives like `<breathing sounds>` confusing the model
- The model generating extended silence or repeated content

### File Naming

Output files include timestamps for iteration:

```
{storyname}_{timestamp}_audiobook.wav
{storyname}_{timestamp}_manifest.json
```

### Cache System Details

**Filename-based cache folders**: The cache folder for each story is based on a hash of the filename (e.g., `maya-window-peek_converted`), not the file content. This means the cache folder stays the same when you re-run generation, making it easier to iterate.

**Cache preservation**: Changing the storyHash or configHash no longer invalidates the entire cache. The system updates those values in the manifest but keeps existing segment audio files.

**Cache recovery**: If the manifest has fewer segments than expected, or was lost entirely, the system automatically scans for existing audio files and recovers them into the manifest. This handles:
- Lost manifest files
- Interrupted processes before saving
- Migration from older cache structures

When recovery happens, you'll see a message like:

```text
ℹ Recovered 15 cached segments from existing audio files
```

**Missing file regeneration**: Before generation starts, the system verifies that all cached segment audio files actually exist on disk. If any are missing (e.g., deleted manually or due to the excessive duration retry), they are automatically added to the generation queue:

```text
⚠ Found 1 cached segment(s) with missing audio files - will regenerate
```

This ensures the final audiobook always includes all segments, even if some cached files were removed.
