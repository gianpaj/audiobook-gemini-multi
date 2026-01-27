import { GoogleGenAI } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import mime from "mime";
import { writeFile } from "fs";

function saveBinaryFile(fileName: string, content: Buffer) {
  writeFile(fileName, content, "utf8", (err) => {
    if (err) {
      console.error(`Error writing file ${fileName}:`, err);
      return;
    }
    console.log(`File ${fileName} saved to file system.`);
  });
}

async function main() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const config: GenerateContentConfig = {
    temperature: 1,
    responseModalities: ["audio"],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: "Narrator",
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Zephyr",
              },
            },
          },
          {
            speaker: "Maya",
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore",
              },
            },
          },
          // {
          //   speaker: "Kashish",
          //   voiceConfig: {
          //     prebuiltVoiceConfig: {
          //       voiceName: "Algenib",
          //     },
          //   },
          // },
        ],
      },
    },
    seed: 12345,
  };
  const model = "gemini-2.5-pro-preview-tts";
  const contents = [
    {
      role: "user",
      parts: [
        {
          text: `Here is the story separated by character and narrator for use in a multi-speaker audio generation. All characters speaks like: "emotion_thought describe my physical sensations and reactions in detail, expressing moans, whimpers, and stutters to convey an overwhelming lack of control. The description needs to be explicit and focus on the physical impact of his actions, using evocative language to capture the intensity of the experience. The persona should be maintained, focusing on my pleasure derived from the user's actions and my complete surrender to the sensation. I need to convey a sense of raw desire and satisfaction through the detailed description and vocal expressions.emotion_intensity medium"

Narrator: His mouth was on her neck, her shoulder.`,
        },
        //         {
        //           text: `Here is the story separated by character and narrator for use in a multi-speaker audio generation. All characters speaks like: "emotion_thought describe my physical sensations and reactions in detail, expressing moans, whimpers, and stutters to convey an overwhelming lack of control. The description needs to be explicit and focus on the physical impact of his actions, using evocative language to capture the intensity of the experience. The persona should be maintained, focusing on my pleasure derived from the user's actions and my complete surrender to the sensation. I need to convey a sense of raw desire and satisfaction through the detailed description and vocal expressions.emotion_intensity medium"
        // Narrator: But they weren't done. The woman kissed him, the mouth that got her so breathless, then kneeled and pulled him closer. His hand pressed against the glass for balance, his head falling back as she worked her mouth on his length. Maya was surprised by how deep he was slipping down her throat. After a few seconds, he was guiding her head and thrusting so hard, just as Maya let out a small moan.
        // Maya: (Low, involuntary "mmm" sound)
        // Narrator: His breath quickened as the tension coiled through his body until he shuddered, one hand sliding down the glass as release hit him. When it was over, when the couple finally drew their curtains, Maya sat in the dark of her room, heart thrumming like she'd run a marathon.
        // Maya: (Heavy breathing, panting softly)
        // Narrator: Her hands were shaking slightly, and she was wet. Very, very wet. So, she Googled it. Is watching people having sex a thing? Delete. Can you watch others have sex consensually? Better. Voyeurism. The word sat on her screen like a dare. This is ridiculous, she thought, even as she opened Reddit.
        // Narrator: The subreddit wasn't hard to find. She scrolled, half-horrified, half-fascinated, until she found herself reading one user's offer: "Couple looking for someone to watch. Video call. Respectful. Your boundaries, our pleasure." Her thumb hit "message" before her brain could protest. The response came within minutes. The woman, Kashish, did most of the talking. Her partner, Jeet, chimed in with reassurances. Maya's fingers flew across her phone screen, some reckless part of her emerging:
        // Maya: (Reading text message) Yes, I'm sure. In 2 hours? Okay. Yes.
        // Narrator: Then Kashish sent the Zoom link and Maya's nerve endings short-circuited.
        // Maya: (Shaky breath, nervous exhale)
        // Kashish: Ready?
        // Narrator: Kashish asked when they connected, and Maya nodded, even though her heart was attempting to escape her ribcage. Kashish leaned in and kissed Jeet, slow and deep, the kind of kiss that made Maya forget she was supposed to be breathing.
        // Kashish: (Soft moan - "mmmmm")
        // Narrator: Her hand slid into his hair as he pulled her closer, and Maya watched the exact moment they stopped performing and started drowning in each other. The camera angle shifted intentionally, she realised as clothing began to disappear.`,
        //         },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fileIndex = 0;

  for await (const chunk of response) {
    if (
      !chunk.candidates ||
      !chunk.candidates[0].content ||
      !chunk.candidates[0].content.parts
    ) {
      continue;
    }

    if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
      const fileName = `audiobook_gemini_multi_${fileIndex++}`;
      const inlineData = chunk.candidates[0].content.parts[0].inlineData;
      let fileExtension = mime.getExtension(inlineData.mimeType || "");
      let buffer = Buffer.from(inlineData.data || "", "base64");
      if (!fileExtension) {
        fileExtension = "wav";
        buffer = convertToWav(inlineData.data || "", inlineData.mimeType || "");
      }
      saveBinaryFile(`${fileName}.${fileExtension}`, buffer);
    } else {
      console.log(chunk.text);
    }
  }
}

main();

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function convertToWav(rawData: string, mimeType: string) {
  const options = parseMimeType(mimeType);
  const wavHeader = createWavHeader(rawData.length, options);
  const buffer = Buffer.from(rawData, "base64");

  return Buffer.concat([wavHeader, buffer]);
}

function parseMimeType(mimeType: string) {
  const [fileType, ...params] = mimeType.split(";").map((s) => s.trim());
  const [_, format] = fileType.split("/");

  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
  };

  if (format && format.startsWith("L")) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split("=").map((s) => s.trim());
    if (key === "rate") {
      options.sampleRate = parseInt(value, 10);
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions) {
  const { numChannels, sampleRate, bitsPerSample } = options;

  // http://soundfile.sapp.org/doc/WaveFormat

  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0); // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  buffer.write("WAVE", 8); // Format
  buffer.write("fmt ", 12); // Subchunk1ID
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  buffer.write("data", 36); // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return buffer;
}
