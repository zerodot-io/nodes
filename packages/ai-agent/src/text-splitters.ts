// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { SPLITTER_ICON } from "./icon";
import {
  DEFAULT_CHUNK,
  mergeParts,
  RAG_KIND,
  SEPARATORS,
  type SeparatorSet,
  splitRecursive,
  type TextSplitter,
} from "./rag";
import { defineSupplyNode } from "./supply";

const chunkFields = (unit: string, size: number, overlap: number) => ({
  chunkSize: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(size)
    .meta({ title: "Chunk Size", description: `The most ${unit} of one chunk` }),
  chunkOverlap: z
    .number()
    .int()
    .min(0)
    .default(overlap)
    .meta({
      title: "Chunk Overlap",
      description: `How many ${unit} a chunk shares with the previous one`,
    }),
});

/** The checked size and overlap. */
function sizes(config: { chunkSize: number; chunkOverlap: number }) {
  if (config.chunkOverlap >= config.chunkSize) {
    throw new Error('"chunkOverlap" must be less than "chunkSize"');
  }
  return { size: config.chunkSize, overlap: config.chunkOverlap };
}

const splitterOf = (split: (text: string) => string[] | Promise<string[]>): TextSplitter => ({
  split: async (text, signal) => {
    signal.throwIfAborted();
    return split(text);
  },
});

const subtitleOf = (config: Record<string, unknown>) =>
  typeof config.chunkSize === "number" ? `${config.chunkSize} / ${config.chunkOverlap}` : undefined;

const recursive = defineSupplyNode({
  type: "agent.splitter.recursive",
  label: "Recursive Character Text Splitter",
  description: "Splits text into chunks, and keeps paragraphs, sentences, and words together",
  category: "integration",
  icon: "ScissorIcon",
  iconUrl: SPLITTER_ICON,
  supplies: RAG_KIND.textSplitter,
  config: z.object({
    ...chunkFields("characters", DEFAULT_CHUNK.size, DEFAULT_CHUNK.overlap),
    format: z
      .enum(["text", "markdown", "html", "code"])
      .default("text")
      .meta({
        title: "Text Format",
        labels: { text: "Plain Text", markdown: "Markdown", html: "HTML", code: "Code" },
        hints: {
          text: "Breaks at paragraphs, lines, sentences, then words",
          markdown: "Breaks at headings and code blocks first",
          html: "Breaks at sections and blocks first",
          code: "Breaks at functions, classes, and blocks first",
        },
      }),
  }),
  defaultConfig: {
    chunkSize: DEFAULT_CHUNK.size,
    chunkOverlap: DEFAULT_CHUNK.overlap,
    format: "text",
  },
  subtitle: subtitleOf,
  supply: ({ config }) => {
    const { size, overlap } = sizes(config);
    const separators = SEPARATORS[config.format satisfies SeparatorSet];
    return splitterOf((text) => splitRecursive(text, size, overlap, separators));
  },
});

/** A separator with `\n` and `\t` written as two characters, as a user types it in a field. */
const separatorOf = (value: string): string =>
  value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");

/** Splits at the separator, and joins the parts into chunks. A part that is too long is cut. */
export function splitCharacters(
  text: string,
  separator: string,
  size: number,
  overlap: number,
): string[] {
  const parts = (separator ? text.split(separator) : [...text]).flatMap((part) =>
    part.length <= size
      ? [part]
      : Array.from({ length: Math.ceil(part.length / size) }, (_, index) =>
          part.slice(index * size, (index + 1) * size),
        ),
  );
  return mergeParts(parts, size, overlap, separator);
}

const character = defineSupplyNode({
  type: "agent.splitter.character",
  label: "Character Text Splitter",
  description: "Splits text at a separator into chunks of a size",
  category: "integration",
  icon: "ScissorIcon",
  iconUrl: SPLITTER_ICON,
  supplies: RAG_KIND.textSplitter,
  config: z.object({
    separator: z.string().default("\\n\\n").meta({
      title: "Separator",
      description: "The text to split at. Write \\n for a new line. Empty splits at each character",
    }),
    ...chunkFields("characters", DEFAULT_CHUNK.size, 0),
  }),
  defaultConfig: { separator: "\\n\\n", chunkSize: DEFAULT_CHUNK.size, chunkOverlap: 0 },
  subtitle: subtitleOf,
  supply: ({ config }) => {
    const { size, overlap } = sizes(config);
    const separator = separatorOf(config.separator);
    return splitterOf((text) => splitCharacters(text, separator, size, overlap));
  },
});

export const ENCODINGS = ["o200k_base", "cl100k_base"] as const;
type Encoding = (typeof ENCODINGS)[number];

type Tokenizer = { encode(text: string): number[]; decode(tokens: number[]): string };

/** The tokenizers load on first use, because the token lists are large. */
const tokenizers = new Map<Encoding, Promise<Tokenizer>>();

function tokenizerOf(encoding: Encoding): Promise<Tokenizer> {
  let found = tokenizers.get(encoding);
  if (!found) {
    found = (async () => {
      const { Tiktoken } = await import("js-tiktoken/lite");
      const ranks =
        encoding === "o200k_base"
          ? (await import("js-tiktoken/ranks/o200k_base")).default
          : (await import("js-tiktoken/ranks/cl100k_base")).default;
      return new Tiktoken(ranks);
    })();
    // A failed load can try again.
    found.catch(() => tokenizers.delete(encoding));
    tokenizers.set(encoding, found);
  }
  return found;
}

/** Splits the tokens of a text into chunks of `size` tokens, and turns each chunk into text. */
export function splitTokens(
  tokenizer: Tokenizer,
  text: string,
  size: number,
  overlap: number,
): string[] {
  const tokens = tokenizer.encode(text);
  const chunks: string[] = [];
  for (let start = 0; start < tokens.length; start += size - overlap) {
    const chunk = tokenizer.decode(tokens.slice(start, start + size)).trim();
    if (chunk) chunks.push(chunk);
    if (start + size >= tokens.length) break;
  }
  return chunks;
}

const token = defineSupplyNode({
  type: "agent.splitter.token",
  label: "Token Text Splitter",
  description: "Splits text into chunks of a number of tokens",
  category: "integration",
  icon: "ScissorIcon",
  iconUrl: SPLITTER_ICON,
  supplies: RAG_KIND.textSplitter,
  config: z.object({
    ...chunkFields("tokens", 500, 50),
    encoding: z
      .enum(ENCODINGS)
      .default("o200k_base")
      .meta({
        title: "Encoding",
        labels: { o200k_base: "o200k_base", cl100k_base: "cl100k_base" },
        hints: {
          o200k_base: "The tokens of the newer OpenAI models",
          cl100k_base: "The tokens of the older OpenAI models, such as Embedding 3",
        },
      }),
  }),
  defaultConfig: { chunkSize: 500, chunkOverlap: 50, encoding: "o200k_base" },
  subtitle: subtitleOf,
  supply: ({ config }) => {
    const { size, overlap } = sizes(config);
    return splitterOf(async (text) =>
      splitTokens(await tokenizerOf(config.encoding), text, size, overlap),
    );
  },
});

export const splitterNodes: NodeDefinition[] = [recursive, character, token];
