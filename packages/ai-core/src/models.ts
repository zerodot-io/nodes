// SPDX-License-Identifier: AGPL-3.0-only

// Model ids for each provider. Each list has the date of its last check.
// To add a model, add a line here. A user can also choose "Custom" and type any model id.
// "OpenAI-compatible" has no list. The user types the model id of the service.

export type ModelEntry = { id: string; label: string; hint: string };

/** The value of a model select that means "use the Custom Model field". */
export const CUSTOM_MODEL = "custom";

// OpenAI: https://developers.openai.com/api/docs/models
// Checked on 2026-10-29. Models that OpenAI marks as deprecated or shut down are not here.

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

export const OPENAI_EMBEDDING_MODELS = [
  { id: "text-embedding-3-small", label: "Embedding 3 Small", hint: "Low cost. 1536 dimensions" },
  {
    id: "text-embedding-3-large",
    label: "Embedding 3 Large",
    hint: "Best quality. 3072 dimensions",
  },
] as const satisfies readonly ModelEntry[];

export const OPENAI_IMAGE_MODELS = [
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
  {
    id: "whisper-1",
    label: "Whisper",
    hint: "Speech in any language to English text. OpenAI marks it as deprecated",
  },
] as const satisfies readonly ModelEntry[];

export const SPEECH_MODELS = [
  {
    id: "gpt-4o-mini-tts",
    label: "GPT-4o mini TTS",
    hint: "Text to speech. OpenAI lists no current speech model",
  },
] as const satisfies readonly ModelEntry[];

// Anthropic: https://docs.anthropic.com/en/docs/about-claude/models/overview
// Checked on 2026-10-29. The "List models" operation shows what the account can use.

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

// Google Gemini: https://ai.google.dev/gemini-api/docs/models
// Checked on 2026-10-29. Models that Google marks as shut down are not here.

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

export const GEMINI_EMBEDDING_MODELS = [
  { id: "gemini-embedding-2", label: "Gemini Embedding 2", hint: "The newest embedding model" },
  { id: "gemini-embedding-001", label: "Gemini Embedding", hint: "The first embedding model" },
] as const satisfies readonly ModelEntry[];

export const GEMINI_IMAGE_MODELS = [
  {
    id: "gemini-nano-banana-2.1",
    label: "Nano Banana 2.1",
    hint: "Google recommends it for new projects",
  },
  { id: "gemini-3.1-flash-image", label: "Nano Banana 2", hint: "Fast image model" },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "Nano Banana 2 Lite",
    hint: "The lowest cost image model",
  },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro", hint: "High detail. Costs more" },
] as const satisfies readonly ModelEntry[];

// The lists below come from the model ids of the AI SDK packages (checked on 2026-10-31). A user
// can choose "Custom" for any other id. OpenRouter, Ollama, and Azure have no list: the user
// types the model id, or the deployment name for Azure.

// Mistral: https://docs.mistral.ai/getting-started/models

export const MISTRAL_TEXT_MODELS = [
  {
    id: "mistral-large-latest",
    label: "Mistral Large",
    hint: "The largest model. The latest version",
  },
  { id: "mistral-medium-latest", label: "Mistral Medium", hint: "A balance of quality and cost" },
  { id: "mistral-small-latest", label: "Mistral Small", hint: "Fast and low cost" },
  { id: "magistral-medium-latest", label: "Magistral Medium", hint: "A reasoning model" },
  { id: "codestral-latest", label: "Codestral", hint: "For code" },
  { id: "ministral-8b-latest", label: "Ministral 8B", hint: "A small model for high volume" },
] as const satisfies readonly ModelEntry[];

export const MISTRAL_EMBEDDING_MODELS = [
  { id: "mistral-embed", label: "Mistral Embed", hint: "For text" },
  { id: "codestral-embed", label: "Codestral Embed", hint: "For code" },
] as const satisfies readonly ModelEntry[];

// Groq: https://console.groq.com/docs/models

export const GROQ_TEXT_MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "The open-weight model of OpenAI" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", hint: "A smaller open-weight model of OpenAI" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", hint: "A general model of Meta" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", hint: "Small and fast" },
  {
    id: "meta-llama/llama-4-maverick-17b-128e-instruct",
    label: "Llama 4 Maverick",
    hint: "A Llama 4 model of Meta",
  },
  { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2", hint: "A model of Moonshot AI" },
  { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", hint: "A model of Alibaba" },
] as const satisfies readonly ModelEntry[];

// xAI: https://docs.x.ai/docs/models

export const XAI_TEXT_MODELS = [
  { id: "grok-4.7", label: "Grok 4.7", hint: "The newest Grok model" },
  { id: "grok-4.6", label: "Grok 4.6", hint: "The previous Grok model" },
  { id: "grok-4.20-reasoning", label: "Grok 4.20 Reasoning", hint: "Thinks before it answers" },
  {
    id: "grok-4.20-non-reasoning",
    label: "Grok 4.20 Non-Reasoning",
    hint: "Answers without thinking. Faster",
  },
  { id: "grok-latest", label: "Grok Latest", hint: "The model that xAI points to now" },
] as const satisfies readonly ModelEntry[];

// DeepSeek: https://api-docs.deepseek.com/quick_start/pricing

export const DEEPSEEK_TEXT_MODELS = [
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "The strongest DeepSeek model" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", hint: "Fast and low cost" },
] as const satisfies readonly ModelEntry[];

// Amazon Bedrock: https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
// Some Regions need the ID of an inference profile, such as us.<model ID>.

export const BEDROCK_TEXT_MODELS = [
  {
    id: "us.anthropic.claude-sonnet-5-5",
    label: "Claude Sonnet 5.5 (US)",
    hint: "Inference profile for US Regions",
  },
  {
    id: "us.anthropic.claude-opus-5-5",
    label: "Claude Opus 5.5 (US)",
    hint: "Inference profile for US Regions",
  },
  {
    id: "us.anthropic.claude-haiku-5-5",
    label: "Claude Haiku 5.5 (US)",
    hint: "Inference profile for US Regions",
  },
  {
    id: "global.anthropic.claude-fable-5-1",
    label: "Claude Fable 5.1 (Global)",
    hint: "Global inference profile",
  },
  {
    id: "anthropic.claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    hint: "The model ID without a profile",
  },
  { id: "us.amazon.nova-pro-v1:0", label: "Amazon Nova Pro (US)", hint: "A model of Amazon" },
  {
    id: "us.amazon.nova-lite-v1:0",
    label: "Amazon Nova Lite (US)",
    hint: "A low-cost model of Amazon",
  },
  {
    id: "us.meta.llama4-scout-17b-instruct-v1:0",
    label: "Llama 4 Scout (US)",
    hint: "A model of Meta",
  },
  { id: "openai.gpt-oss-120b-1:0", label: "GPT-OSS 120B", hint: "The open-weight model of OpenAI" },
] as const satisfies readonly ModelEntry[];

export const BEDROCK_EMBEDDING_MODELS = [
  {
    id: "amazon.titan-embed-text-v2:0",
    label: "Titan Text Embeddings V2",
    hint: "A model of Amazon",
  },
  {
    id: "cohere.embed-multilingual-v3",
    label: "Cohere Embed Multilingual",
    hint: "For many languages",
  },
  { id: "cohere.embed-english-v3", label: "Cohere Embed English", hint: "For English" },
] as const satisfies readonly ModelEntry[];

// Google Vertex AI: https://cloud.google.com/vertex-ai/generative-ai/docs/models

export const VERTEX_TEXT_MODELS = [
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
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
    hint: "A Pro model that Google has not marked as stable",
  },
] as const satisfies readonly ModelEntry[];

export const VERTEX_EMBEDDING_MODELS = [
  { id: "gemini-embedding-2", label: "Gemini Embedding 2", hint: "The newest embedding model" },
  {
    id: "gemini-embedding-001",
    label: "Gemini Embedding",
    hint: "The first Gemini embedding model",
  },
  { id: "text-embedding-005", label: "Text Embedding 005", hint: "An older text model" },
] as const satisfies readonly ModelEntry[];

/** The ids of a list, and the Custom value, as a tuple for `z.enum`. */
export const idsOf = (models: readonly ModelEntry[]): [string, ...string[]] => {
  const [first, ...rest] = models.map((model) => model.id);
  return [first ?? CUSTOM_MODEL, ...rest, CUSTOM_MODEL];
};
