# AGENTS.md - AI Agent Guidelines for Audiobook Generator

## Project Overview

This is a TypeScript CLI tool for generating audiobooks from story scripts using Google's Gemini TTS API with multi-speaker support.

## Project Structure

```
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
- `pnpm run preview <storyFile> -n 5` - Generate preview (first N segments)
- `pnpm run convert <inputFile>` - Convert plain text to story format using AI
- `pnpm run init <storyFile>` - Create config from story speakers
- `pnpm run clean` - Clear cache and output files
- `pnpm run test` - Run Vitest tests
- `pnpm run typecheck` - Run TypeScript type checking

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
```
[NARRATOR] Once upon a time...
[ALICE] Hello there!
```
or
```
NARRATOR: Once upon a time...
ALICE: Hello there!
```

### Environment Variables

- `GEMINI_API_KEY` - Required for TTS generation and text conversion
- `TTS_DEBUG_LOG` - Optional path to write debug logs to a file (legacy, for backwards compatibility)

### Debug Logging

Debug logs are automatically written to `{outputDir}/.audiobook-cache/{storyHash}/debug.log` inside each story's cache folder. This includes:
- TTS request details (voice, seed, text prompt)
- API response information
- Retry attempts with seed increments

You can also set `TTS_DEBUG_LOG` environment variable to write logs to an additional file.

### Testing

- All tests use Vitest with mocked APIs
- The `@google/genai` module is mocked in tests
- When adding new imports from `@google/genai`, update the mock in `src/__tests__/tts-provider.test.ts`
- File system is mocked using `memfs`

### Common Issues

1. **Tests failing with "No export defined on mock"**: Add missing exports to the `vi.mock("@google/genai")` block in test files

2. **`maxRetries: 0` not working**: Use nullish coalescing (`??`) not logical OR (`||`) for numeric options that can be 0

3. **Progress bar corrupting output**: Use `console.error()` or `process.stderr.write()` for debug output during generation

4. **Cached segments used when --force specified**: Ensure the force flag is properly passed through the command chain

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

### Automatic Seed Retry for "OTHER" Errors

When Gemini TTS returns `finishReason: OTHER`, the system automatically retries with an incremented seed:
- Original attempt uses seed `N`
- Retry 1 uses seed `N + 1`
- Retry 2 uses seed `N + 2`
- Retry 3 uses seed `N + 3`
- After 4 total attempts, returns the error

A warning message is printed to stderr:
```
⚠️  Generation failed with OTHER, retrying with seed 101 (attempt 2/4)
```

This behavior is implemented in both `generateAudio` and `generateMultiSpeaker` methods in `tts-provider.ts`.

### File Naming

Output files include timestamps for iteration:
```
{storyname}_{timestamp}_audiobook.wav
{storyname}_{timestamp}_manifest.json
```
