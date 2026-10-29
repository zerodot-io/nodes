// SPDX-License-Identifier: AGPL-3.0-only

// Model ids from the OpenAI model docs (https://developers.openai.com/api/docs/models).
// Checked on 2026-10-29. Models that OpenAI marks as deprecated or shut down are not here.
// To add a model, add a line here. A user can also choose "Custom" and type any model id.

export type ModelEntry = { id: string; label: string; hint: string };

/** The value of the model select that means "use the Custom Model field". */
export const CUSTOM_MODEL = "custom";

export const TEXT_MODELS = [
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    hint: "The flagship. Best for hard reasoning and code",
  },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", hint: "Close to Astra in quality, at a lower cost" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", hint: "Fast and efficient" },
  { id: "gpt-6-luna", label: "GPT-6 Luna", hint: "The most efficient. For high-volume work" },
  { id: "gpt-5.5", label: "GPT-5.5", hint: "The previous flagship" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", hint: "Small and fast, for high-volume work" },
] as const satisfies readonly ModelEntry[];

export const EMBEDDING_MODELS = [
  {
    id: "text-embedding-3-small",
    label: "Embedding 3 Small",
    hint: "Low cost. 1536 dimensions",
  },
  {
    id: "text-embedding-3-large",
    label: "Embedding 3 Large",
    hint: "Best quality. 3072 dimensions",
  },
] as const satisfies readonly ModelEntry[];

export const IMAGE_MODELS = [
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    hint: "The most capable image model",
  },
  { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", hint: "Fast image model" },
  { id: "gpt-image-2", label: "GPT Image 2", hint: "The previous image model" },
] as const satisfies readonly ModelEntry[];

export const MODERATION_MODELS = [
  {
    id: "omni-moderation-latest",
    label: "Omni Moderation",
    hint: "Checks text and images. The latest version",
  },
] as const satisfies readonly ModelEntry[];

export const TRANSCRIPTION_MODELS = [
  { id: "gpt-transcribe", label: "GPT Transcribe", hint: "Speech to text" },
] as const satisfies readonly ModelEntry[];

export const TRANSLATION_MODELS = [
  { id: "whisper-1", label: "Whisper", hint: "Speech in any language to English text" },
] as const satisfies readonly ModelEntry[];

export const SPEECH_MODELS = [
  {
    id: "gpt-4o-mini-tts",
    label: "GPT-4o mini TTS",
    hint: "Text to speech. OpenAI lists no current speech model",
  },
] as const satisfies readonly ModelEntry[];

/** The ids of a list, and the Custom value, as a tuple for `z.enum`. */
export const idsOf = (models: readonly ModelEntry[]): [string, ...string[]] => {
  const [first, ...rest] = models.map((model) => model.id);
  return [first ?? CUSTOM_MODEL, ...rest, CUSTOM_MODEL];
};
