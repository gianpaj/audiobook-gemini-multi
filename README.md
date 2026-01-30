# Audiobook Generator

A TypeScript CLI tool for generating audiobooks from story scripts using Text-to-Speech APIs with multi-speaker support.

## Features

- **Multi-speaker support**: Assign different voices to different characters
- **Smart caching**: Only regenerate segments when text or voice settings change
- **Resume capability**: Continue interrupted generations from where they left off
- **Iterative workflow**: Easily refine voice styles without regenerating unchanged segments
- **Progress tracking**: Visual progress bars and time estimates
- **Manifest export**: Get timestamps and metadata for each segment
- **Configurable**: Full control over voice settings, audio format, and API parameters

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd audiobook-gemini-multi

# Install dependencies
pnpm install

# Set up your API key
echo "GEMINI_API_KEY=your_api_key_here" > .env
```

## Quick Start

```bash
# 1. Initialize a new project with config based on your story
pnpm run init examples/story.txt

# 2. Edit config.json to customize voices (optional)

# 3. Generate the audiobook
pnpm run generate examples/story.txt

# 4. Find your audiobook in the output directory
ls output/
```

## Story Format

The generator supports two story formats:

### Bracket Format (Recommended)

```
[NARRATOR] Once upon a time in a land far away...
[CHARACTER1] Hello there! How are you today?
[CHARACTER2] I'm doing well, thank you for asking.
```

### Colon Format

```
NARRATOR: Once upon a time in a land far away...
CHARACTER1: Hello there! How are you today?
CHARACTER2: I'm doing well, thank you for asking.
```

### Comments

Lines starting with `#` or `//` are treated as comments and ignored.

## CLI Commands

### `convert <inputFile>`

Convert plain text or prose to speaker-tagged story format using AI.

```bash
pnpm run convert novel.txt
# Options:
#   -o, --output <path>     Output file path (default: input_converted.txt)
#   -f, --format <type>     Output format: bracket or colon (default: bracket)
#   -s, --speakers <names>  Comma-separated list of speaker names to use
#   --no-narrator           Exclude NARRATOR tag (dialogue only)
#   --prompt-only           Show the conversion prompt without calling the API
#   -v, --verbose           Verbose output
```

This command uses the Gemini LLM to analyze your text and convert it into the speaker-tagged format required for audiobook generation. It will:

- Identify characters and dialogue
- Add NARRATOR tags for descriptive text
- Split content into appropriate segments

**Example:**

```bash
# Convert a novel chapter
pnpm run convert chapter1.txt -o chapter1_story.txt

# Convert with specific speakers
pnpm run convert dialogue.txt -s "JOHN,MARY,NARRATOR"

# Use colon format instead of brackets
pnpm run convert story.txt -f colon

# Preview the prompt without calling the API
pnpm run convert story.txt --prompt-only
```

### `setup`

Initialize a new project with default configuration.

```bash
pnpm run setup
# Options:
#   -o, --output <path>  Output directory (default: "./output")
#   -f, --force         Overwrite existing config
```

### `init <storyFile>`

Create a configuration file based on speakers found in a story.

```bash
pnpm run init story.txt
# Options:
#   -o, --output <path>  Config output path (default: "./config.json")
#   -f, --force         Overwrite existing config
```

### `generate <storyFile>`

Generate a complete audiobook from a story file.

```bash
pnpm run generate story.txt
# Options:
#   -c, --config <path>  Path to config file (default: "./config.json")
#   -o, --output <path>  Output directory (default: "./output")
#   -f, --force         Force regeneration (ignore cache)
#   -v, --verbose       Verbose output
#   -d, --dry-run       Show what would be done without generating
```

### `preview <storyFile>`

Generate a preview with only the first N segments.

```bash
pnpm run preview story.txt -- -n 5
# Options:
#   -c, --config <path>      Path to config file
#   -o, --output <path>      Output directory
#   -n, --segments <number>  Number of segments to preview (default: 5)
#   -s, --start <number>     Start from segment index (default: 0)
#   --speaker <name>         Preview only specific speaker
#   -f, --force             Force regeneration
#   -v, --verbose           Verbose output
```

### `update-styles <storyFile>`

Regenerate segments that have changed style prompts.

```bash
pnpm run update-styles story.txt
# Options:
#   -c, --config <path>       Path to config file
#   -o, --output <path>       Output directory
#   -s, --speakers <names>    Specific speakers to update (comma-separated)
#   -f, --force              Force update even if unchanged
#   -v, --verbose            Verbose output
```

### `clean`

Clear cache and generated files.

```bash
pnpm run clean -- --force
# Options:
#   -o, --output <path>  Output directory
#   --cache-only        Only clear cache, keep generated audiobooks
#   --output-only       Only clear output files, keep cache
#   -f, --force         Don't ask for confirmation
```

### `info [storyFile]`

Show project and cache information.

```bash
pnpm run info story.txt
# Options:
#   -c, --config <path>  Path to config file
#   -o, --output <path>  Output directory
```

### `voices`

List available TTS voices.

```bash
pnpm run voices
```

## Workflow Example: Converting Plain Text

If you have a story in plain prose format (like a novel or script), use the `convert` command first:

```bash
# 1. Convert your plain text to speaker-tagged format
pnpm run convert my-novel.txt -o my-story.txt

# 2. Review and edit the converted file if needed
# The AI does a good job but you may want to adjust speaker assignments

# 3. Initialize config based on detected speakers
pnpm run init my-story.txt

# 4. Customize voices in config.json

# 5. Generate the audiobook
pnpm run generate my-story.txt
```

## Configuration

The `config.json` file controls all aspects of audiobook generation:

```json
{
  "version": "1.0.0",
  "provider": {
    "name": "gemini",
    "apiKey": "${GEMINI_API_KEY}",
    "model": "gemini-2.5-pro-preview-tts",
    "rateLimit": 60,
    "maxRetries": 3,
    "timeout": 60000
  },
  "audio": {
    "format": "wav",
    "sampleRate": 24000,
    "bitDepth": 16,
    "silencePadding": 500,
    "normalize": false
  },
  "voices": [
    {
      "name": "NARRATOR",
      "voiceName": "Zephyr",
      "stylePrompt": "Calm, measured storytelling voice",
      "speed": 1.0
    },
    {
      "name": "CHARACTER1",
      "voiceName": "Kore",
      "stylePrompt": "Young, energetic woman",
      "speed": 1.0
    }
  ],
  "defaultVoice": {
    "voiceName": "Zephyr",
    "stylePrompt": "Natural speaking voice",
    "speed": 1.0
  },
  "globalSeed": 12345
}
```

### Configuration Options

#### Provider Settings

| Option | Type | Description |
| ------ | ---- | ----------- |
| `name` | string | TTS provider name ("gemini") |
| `apiKey` | string | API key (supports env vars like `${GEMINI_API_KEY}`) |
| `model` | string | Model to use for generation |
| `rateLimit` | number | Max requests per minute |
| `maxRetries` | number | Retry count for failed requests |
| `timeout` | number | Request timeout in milliseconds |

#### Audio Settings

| Option | Type | Description |
| ------ | ---- | ----------- |
| `format` | string | Output format: "wav", "mp3", "ogg", "flac" |
| `sampleRate` | number | Sample rate in Hz (default: 24000) |
| `bitDepth` | number | Bit depth: 16, 24, or 32 |
| `silencePadding` | number | Silence between segments in ms |
| `normalize` | boolean | Normalize audio levels |

#### Voice Settings

| Option | Type | Description |
| ------ | ---- | ----------- |
| `name` | string | Speaker name (must match tags in story) |
| `voiceName` | string | Gemini voice name |
| `stylePrompt` | string | Description of voice style/emotion |
| `speed` | number | Speaking speed (0.5-2.0) |
| `pitch` | number | Pitch adjustment (-1.0 to 1.0) |
| `seed` | number | Voice seed for consistency |

### Available Gemini Voices

- **Zephyr** - Balanced, clear narrator voice
- **Puck** - Light, playful voice
- **Charon** - Deep, authoritative voice
- **Kore** - Warm, friendly female voice
- **Fenrir** - Strong, dramatic voice
- **Leda** - Soft, gentle voice
- **Orus** - Mature, wise voice
- **Aoede** - Musical, expressive voice
- **Callirrhoe** - Clear, articulate voice
- **Autonoe** - Energetic, youthful voice
- **Enceladus** - Powerful, resonant voice
- **Iapetus** - Deep, thoughtful voice
- **Umbriel** - Mysterious, atmospheric voice
- **Algenib** - Bright, engaging voice

## Workflow Example

### Initial Generation

```bash
# Create config from your story
pnpm run init my-story.txt

# Review and edit config.json to customize voices
# Then generate
pnpm run generate my-story.txt
```

### Iterating on Voice Styles

```bash
# Edit config.json - change a character's stylePrompt

# Regenerate only changed segments
pnpm run update-styles my-story.txt

# Or preview changes first
pnpm run preview my-story.txt -- --speaker CHARACTER1
```

### Resuming Interrupted Generation

If generation is interrupted, simply run the same command again:

```bash
pnpm run generate my-story.txt
# Will pick up from where it left off
```

### Force Full Regeneration

```bash
pnpm run generate my-story.txt -- --force
```

## Output Files

After generation, you'll find these files in the output directory:

```text
output/
├── .audiobook-cache/           # Cache directory
│   ├── manifest.json           # Cache manifest
│   └── segments/               # Individual segment audio files
│       ├── seg_0000_abc123.wav
│       ├── seg_0001_def456.wav
│       └── ...
├── my-story_audiobook.wav      # Final stitched audiobook
└── my-story_manifest.json      # Manifest with timestamps
```

### Manifest Format

The manifest file contains metadata and timestamps for each segment:

```json
{
  "version": "1.0.0",
  "title": "my-story",
  "sourceFile": "my-story.txt",
  "outputFile": "my-story_audiobook.wav",
  "totalDurationMs": 180000,
  "format": "wav",
  "sampleRate": 24000,
  "speakers": ["NARRATOR", "CHARACTER1"],
  "segments": [
    {
      "index": 0,
      "speaker": "NARRATOR",
      "text": "Once upon a time...",
      "startMs": 0,
      "endMs": 5000,
      "durationMs": 5000,
      "audioFile": "seg_0000_abc123.wav"
    }
  ],
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "provider": "gemini"
}
```

## Programmatic Usage

You can also use the library programmatically:

```typescript
import {
  parseFile,
  loadConfig,
  createTTSProvider,
  generateSegmentAudio,
  stitchAudioFiles,
} from 'audiobook-gemini-multi';

// Parse story
const story = await parseFile('story.txt');

// Load config
const config = await loadConfig('config.json');

// Initialize provider
const provider = createTTSProvider(config);
await provider.initialize();

// Generate segments
for (const segment of story.segments) {
  const response = await generateSegmentAudio(
    provider,
    segment,
    config,
    `output/${segment.id}.wav`
  );
}

// Stitch together
await stitchAudioFiles(audioFiles, 'output/audiobook.wav');
```

## Environment Variables

| Variable | Description |
| -------- | ----------- |
| `GEMINI_API_KEY` | Your Google Gemini API key (used for both TTS and text conversion) |

## Troubleshooting

### "API key not found"

Make sure you have set the `GEMINI_API_KEY` environment variable or configured it in `config.json`.

### "Rate limit exceeded"

The generator automatically handles rate limiting, but if you see persistent errors, try reducing the `rateLimit` setting in config.json.

### "Generation failed"

Check the verbose output with `-v` flag for more details. The generator will retry failed requests automatically.

### Cached files are being regenerated

The cache is invalidated when:

- The story text for a segment changes
- The voice configuration for a speaker changes
- The config.json is modified

Use `--force` only when you explicitly want to regenerate everything.

## Development

```bash
# Type check
pnpm run typecheck

# Build for production
pnpm run build

# Run with tsx (development)
pnpm run dev generate examples/story.txt
```

## License

ISC
