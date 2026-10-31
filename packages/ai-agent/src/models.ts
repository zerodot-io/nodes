// SPDX-License-Identifier: AGPL-3.0-only

// The chat models of @zerodot/ai, from its lists. Each list has the date of its last check.
// A user can also choose "Custom" and type any model id. "OpenAI-compatible" has no list.

export type ModelEntry = { id: string; label: string; hint: string };

/** The value of a model select that means "use the Custom Model field". */
export const CUSTOM_MODEL = "custom";

// OpenAI: https://developers.openai.com/api/docs/models. Checked on 2026-10-29.

export const OPENAI_TEXT_MODELS = [
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

// Anthropic: https://docs.anthropic.com/en/docs/about-claude/models/overview. Checked on 2026-10-29.

export const ANTHROPIC_MODELS = [
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    hint: "The strongest. For hard reasoning and long agent work",
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    hint: "Strong. For coding and knowledge work",
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    hint: "Fast and smart. A good first choice",
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    hint: "The fastest and the cheapest. For high volume",
  },
] as const satisfies readonly ModelEntry[];

// Google Gemini: https://ai.google.dev/gemini-api/docs/models. Checked on 2026-10-29.

export const GEMINI_TEXT_MODELS = [
  { id: "gemini-4-argon", label: "Gemini 4 Argon", hint: "The strongest. For hard reasoning" },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    hint: "Fast and smart. A good first choice",
  },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", hint: "The previous Flash model" },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    hint: "The cheapest. For high volume",
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    hint: "The previous Flash-Lite model",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
    hint: "A Pro model that Google has not marked as stable",
  },
] as const satisfies readonly ModelEntry[];

// The embedding models of @zerodot/ai, from the same lists.

export const OPENAI_EMBEDDING_MODELS = [
  { id: "text-embedding-3-small", label: "Embedding 3 Small", hint: "Low cost. 1536 dimensions" },
  {
    id: "text-embedding-3-large",
    label: "Embedding 3 Large",
    hint: "Best quality. 3072 dimensions",
  },
] as const satisfies readonly ModelEntry[];

export const GEMINI_EMBEDDING_MODELS = [
  { id: "gemini-embedding-2", label: "Gemini Embedding 2", hint: "The newest embedding model" },
  { id: "gemini-embedding-001", label: "Gemini Embedding", hint: "The first embedding model" },
] as const satisfies readonly ModelEntry[];

/** The ids of a list, and the Custom value, as a tuple for `z.enum`. */
export const idsOf = (models: readonly ModelEntry[]): [string, ...string[]] => {
  const [first, ...rest] = models.map((model) => model.id);
  return [first ?? CUSTOM_MODEL, ...rest, CUSTOM_MODEL];
};
