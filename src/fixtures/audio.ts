/**
 * Test fixtures for audio buffers and WAV data
 */

/**
 * Create a valid WAV header buffer
 */
export function createWavHeader(
  dataLength: number,
  options: {
    numChannels?: number;
    sampleRate?: number;
    bitsPerSample?: number;
  } = {},
): Buffer {
  const { numChannels = 1, sampleRate = 24000, bitsPerSample = 16 } = options;

  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

/**
 * Create a simple WAV buffer with silence
 *
 * @param durationMs Duration in milliseconds
 * @param options WAV options
 */
export function createSilentWav(
  durationMs: number,
  options: {
    numChannels?: number;
    sampleRate?: number;
    bitsPerSample?: number;
  } = {},
): Buffer {
  const { numChannels = 1, sampleRate = 24000, bitsPerSample = 16 } = options;

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const dataLength = numSamples * numChannels * bytesPerSample;

  const header = createWavHeader(dataLength, options);
  const data = Buffer.alloc(dataLength, 0); // Silence

  return Buffer.concat([header, data]);
}

/**
 * Create a WAV buffer with a simple sine wave tone
 *
 * @param durationMs Duration in milliseconds
 * @param frequency Frequency in Hz
 * @param options WAV options
 */
export function createToneWav(
  durationMs: number,
  frequency: number = 440,
  options: {
    numChannels?: number;
    sampleRate?: number;
    bitsPerSample?: number;
    amplitude?: number;
  } = {},
): Buffer {
  const {
    numChannels = 1,
    sampleRate = 24000,
    bitsPerSample = 16,
    amplitude = 0.5,
  } = options;

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const dataLength = numSamples * numChannels * bytesPerSample;

  const header = createWavHeader(dataLength, { numChannels, sampleRate, bitsPerSample });
  const data = Buffer.alloc(dataLength);

  const maxValue = Math.pow(2, bitsPerSample - 1) - 1;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * frequency * t) * amplitude * maxValue;
    const intValue = Math.round(value);

    for (let channel = 0; channel < numChannels; channel++) {
      const offset = (i * numChannels + channel) * bytesPerSample;
      if (bitsPerSample === 16) {
        data.writeInt16LE(intValue, offset);
      } else if (bitsPerSample === 24) {
        // Write 24-bit as 3 bytes
        data.writeIntLE(intValue, offset, 3);
      } else if (bitsPerSample === 32) {
        data.writeInt32LE(intValue, offset);
      }
    }
  }

  return Buffer.concat([header, data]);
}

/**
 * Pre-created test WAV buffers
 */

// 100ms of silence at 24kHz, 16-bit mono
export const SILENT_WAV_100MS = createSilentWav(100);

// 500ms of silence at 24kHz, 16-bit mono
export const SILENT_WAV_500MS = createSilentWav(500);

// 1 second of silence at 24kHz, 16-bit mono
export const SILENT_WAV_1S = createSilentWav(1000);

// 100ms of 440Hz tone (A4) at 24kHz, 16-bit mono
export const TONE_WAV_100MS = createToneWav(100, 440);

// 500ms of 440Hz tone at 24kHz, 16-bit mono
export const TONE_WAV_500MS = createToneWav(500, 440);

// 1 second of 440Hz tone at 24kHz, 16-bit mono
export const TONE_WAV_1S = createToneWav(1000, 440);

// Stereo WAV (100ms silence)
export const STEREO_WAV_100MS = createSilentWav(100, { numChannels: 2 });

// Different sample rate (44100Hz, 100ms silence)
export const WAV_44100HZ_100MS = createSilentWav(100, { sampleRate: 44100 });

// 24-bit WAV (100ms silence)
export const WAV_24BIT_100MS = createSilentWav(100, { bitsPerSample: 24 });

/**
 * Invalid/corrupted WAV data for testing error handling
 */

// Too short to be a valid WAV
export const INVALID_WAV_TOO_SHORT = Buffer.from("RIFF");

// Wrong RIFF header
export const INVALID_WAV_BAD_RIFF = Buffer.alloc(44);
INVALID_WAV_BAD_RIFF.write("XXXX", 0);

// Wrong WAVE format
export const INVALID_WAV_BAD_WAVE = (() => {
  const buf = createWavHeader(0);
  buf.write("XXXX", 8);
  return buf;
})();

// Empty data buffer (valid header, no data)
export const EMPTY_WAV = createWavHeader(0);

/**
 * Calculate expected duration from WAV buffer
 */
export function calculateWavDuration(buffer: Buffer): number {
  if (buffer.length < 44) return 0;

  const sampleRate = buffer.readUInt32LE(24);
  const numChannels = buffer.readUInt16LE(22);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataSize = buffer.readUInt32LE(40);

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = dataSize / (numChannels * bytesPerSample);

  return (numSamples / sampleRate) * 1000;
}

/**
 * Extract audio data (without header) from WAV buffer
 */
export function extractWavData(buffer: Buffer): Buffer {
  if (buffer.length <= 44) return Buffer.alloc(0);
  return buffer.subarray(44);
}

/**
 * Test segment audio data for mocking TTS responses
 */
export interface MockAudioSegment {
  segmentId: string;
  speaker: string;
  text: string;
  audioBuffer: Buffer;
  durationMs: number;
}

/**
 * Create mock audio segments for testing
 */
export function createMockAudioSegments(
  segments: Array<{ id: string; speaker: string; text: string }>,
  durationMs: number = 500,
): MockAudioSegment[] {
  return segments.map((segment) => ({
    segmentId: segment.id,
    speaker: segment.speaker,
    text: segment.text,
    audioBuffer: createSilentWav(durationMs),
    durationMs,
  }));
}

/**
 * Base64 encoded audio data (for mocking API responses)
 */
export function createBase64AudioData(durationMs: number = 100): string {
  // Create raw PCM data (without WAV header) for API mock
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const dataLength = numSamples * (bitsPerSample / 8);
  const data = Buffer.alloc(dataLength, 0);

  return data.toString("base64");
}

/**
 * Mock API audio response format
 */
export const MOCK_API_AUDIO_RESPONSE = {
  mimeType: "audio/L16;rate=24000",
  data: createBase64AudioData(500),
};
