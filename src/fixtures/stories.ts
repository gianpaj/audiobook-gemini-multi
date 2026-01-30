/**
 * Test fixtures for story content
 */

/**
 * Simple story in bracket format
 */
export const BRACKET_FORMAT_STORY = `
[NARRATOR] Once upon a time, there was a small village.
[NARRATOR] In this village lived a young girl named Alice.
[ALICE] Hello, world! I'm so happy to be here.
[NARRATOR] Alice loved to explore the forest nearby.
[BOB] Hey Alice, where are you going?
[ALICE] I'm going to find the magic tree!
[BOB] Can I come with you?
[ALICE] Of course! Let's go together.
[NARRATOR] And so, their adventure began.
`.trim();

/**
 * Simple story in colon format
 */
export const COLON_FORMAT_STORY = `
NARRATOR: Once upon a time, there was a small village.
NARRATOR: In this village lived a young girl named Alice.
ALICE: Hello, world! I'm so happy to be here.
NARRATOR: Alice loved to explore the forest nearby.
BOB: Hey Alice, where are you going?
ALICE: I'm going to find the magic tree!
BOB: Can I come with you?
ALICE: Of course! Let's go together.
NARRATOR: And so, their adventure began.
`.trim();

/**
 * Mixed format story (should detect as mixed)
 */
export const MIXED_FORMAT_STORY = `
[NARRATOR] This story uses mixed formats.
ALICE: Sometimes I use colons.
[BOB] And sometimes brackets.
NARRATOR: It's a bit confusing.
`.trim();

/**
 * Story with comments
 */
export const STORY_WITH_COMMENTS = `
# This is a comment at the start
[NARRATOR] Once upon a time...

// Another comment style
[ALICE] Hello there!

# Comments should be ignored
[BOB] Hi Alice!
`.trim();

/**
 * Story with empty lines
 */
export const STORY_WITH_EMPTY_LINES = `
[NARRATOR] First paragraph of the story.

[NARRATOR] Second paragraph after empty line.


[ALICE] Speaking after two empty lines.

[BOB] Final line.
`.trim();

/**
 * Single speaker story
 */
export const SINGLE_SPEAKER_STORY = `
[NARRATOR] This is a monologue.
[NARRATOR] Only one speaker throughout.
[NARRATOR] No other characters appear.
`.trim();

/**
 * Story with very long segment
 */
export const STORY_WITH_LONG_SEGMENT = `
[NARRATOR] ${"This is a very long segment that goes on and on. ".repeat(150)}
[ALICE] Short response.
`.trim();

/**
 * Story with very short segments
 */
export const STORY_WITH_SHORT_SEGMENTS = `
[ALICE] Hi!
[BOB] Hey.
[ALICE] Ok.
[BOB] Bye.
`.trim();

/**
 * Empty story (only comments and whitespace)
 */
export const EMPTY_STORY = `
# Just a comment
// Another comment


`.trim();

/**
 * Story with unusual speaker names
 */
export const STORY_WITH_UNUSUAL_SPEAKERS = `
[NARRATOR_V2] Modern narrator speaking.
[CHARACTER_123] I have numbers in my name.
[A] Single letter name.
`.trim();

/**
 * Story for testing speaker extraction
 */
export const MULTI_SPEAKER_STORY = `
[NARRATOR] Introduction.
[HERO] I am the hero!
[VILLAIN] And I am the villain.
[SIDEKICK] Don't forget me!
[NARRATOR] They all met at the crossroads.
[HERO] We must stop the villain!
[VILLAIN] You'll never catch me!
[SIDEKICK] I'll help you, hero!
[NARRATOR] The battle was about to begin.
`.trim();

/**
 * Expected parsed segments for BRACKET_FORMAT_STORY
 */
export const EXPECTED_BRACKET_SEGMENTS = [
  { speaker: "NARRATOR", text: "Once upon a time, there was a small village." },
  { speaker: "NARRATOR", text: "In this village lived a young girl named Alice." },
  { speaker: "ALICE", text: "Hello, world! I'm so happy to be here." },
  { speaker: "NARRATOR", text: "Alice loved to explore the forest nearby." },
  { speaker: "BOB", text: "Hey Alice, where are you going?" },
  { speaker: "ALICE", text: "I'm going to find the magic tree!" },
  { speaker: "BOB", text: "Can I come with you?" },
  { speaker: "ALICE", text: "Of course! Let's go together." },
  { speaker: "NARRATOR", text: "And so, their adventure began." },
];

/**
 * Expected speakers for BRACKET_FORMAT_STORY
 */
export const EXPECTED_BRACKET_SPEAKERS = ["ALICE", "BOB", "NARRATOR"];

/**
 * Expected speakers for MULTI_SPEAKER_STORY
 */
export const EXPECTED_MULTI_SPEAKERS = ["HERO", "NARRATOR", "SIDEKICK", "VILLAIN"];
