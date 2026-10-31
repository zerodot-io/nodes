// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord, readBinary, resolveTemplate } from "@zerodot/node-sdk";
import { z } from "zod";
import { DOCUMENT_ICON } from "./icon";
import {
  DEFAULT_CHUNK,
  type Document,
  type DocumentLoader,
  filterOf,
  isTextSplitter,
  RAG_KIND,
  SEPARATORS,
  splitRecursive,
  supplyOn,
  type TextSplitter,
  textOf,
} from "./rag";
import { defineSupplyNode, suppliesOf } from "./supply";

type Row = Record<string, unknown>;

export const FORMATS = ["auto", "pdf", "text", "markdown", "html", "json"] as const;
type Format = (typeof FORMATS)[number];

/** The format of a file from its type or its name. Other files are read as text. */
export function formatOf(mimeType: string, fileName = ""): Exclude<Format, "auto"> {
  const name = fileName.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mimeType === "text/markdown" || /\.(md|markdown)$/.test(name)) return "markdown";
  if (mimeType === "text/html" || /\.html?$/.test(name)) return "html";
  if (mimeType === "application/json" || name.endsWith(".json")) return "json";
  return "text";
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The text of an HTML page: no scripts, styles, or tags, and a new line after each block. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

/** The text of a file. */
async function fileText(bytes: Buffer, format: Exclude<Format, "auto">): Promise<string> {
  if (format === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(bytes));
    } catch {
      throw new Error("The binary data is not a PDF file that this node can read");
    }
    const { text } = await extractText(pdf, { mergePages: false });
    return text.join("\n\n");
  }
  const text = bytes.toString("utf8");
  if (format === "html") return htmlText(text);
  if (format === "json") {
    try {
      return textOf(JSON.parse(text));
    } catch {
      throw new Error("The binary data is not valid JSON");
    }
  }
  return text;
}

export type LoaderOptions = {
  dataType: "json" | "binary";
  mode: "all" | "specific";
  /** The text template of "specific". It reads one item. */
  text: string;
  binaryProperty: string;
  format: Format;
  /** Fields of the item to keep with each chunk. */
  metadataFields: string[];
  /** A JSON object template. It reads one item. */
  metadata: string;
  scope: Row;
};

/** The chunks of the items. Each chunk keeps the metadata of its item. */
export function documentLoader(
  options: LoaderOptions,
  splitter: TextSplitter | undefined,
): DocumentLoader {
  return {
    async load(items, signal) {
      // The scope of the build can be of an earlier run of the parent, so the item keys are new.
      const resolve = (template: string, item: Row, index: number) =>
        resolveTemplate(template, {
          ...options.scope,
          $input: items,
          $item: item,
          $json: item,
          $index: index,
        });
      const documents: Document[] = [];
      for (const [index, item] of items.entries()) {
        signal.throwIfAborted();
        let text: string;
        let format: Exclude<Format, "auto"> = "text";
        const metadata: Row = {};
        if (options.dataType === "binary") {
          const file = readBinary(item, options.binaryProperty);
          format =
            options.format === "auto" ? formatOf(file.mimeType, file.fileName) : options.format;
          if (/^(image|audio|video)\//.test(file.mimeType) && options.format === "auto") {
            throw new Error(`Item ${index}: the node cannot read text from ${file.mimeType}`);
          }
          text = await fileText(Buffer.from(file.data, "base64"), format);
          if (file.fileName) metadata.fileName = file.fileName;
          metadata.mimeType = file.mimeType;
        } else {
          text = textOf(options.mode === "specific" ? resolve(options.text, item, index) : item);
        }
        for (const field of options.metadataFields) {
          if (field in item) metadata[field] = item[field];
        }
        const extra = options.metadata.trim()
          ? filterOf(resolve(options.metadata, item, index), "metadata")
          : undefined;
        Object.assign(metadata, extra);
        const chunks = splitter
          ? await splitter.split(text, signal)
          : splitRecursive(
              text,
              DEFAULT_CHUNK.size,
              DEFAULT_CHUNK.overlap,
              format === "markdown" ? SEPARATORS.markdown : SEPARATORS.text,
            );
        for (const content of chunks) documents.push({ content, metadata: { ...metadata } });
      }
      return documents;
    },
  };
}

export default defineSupplyNode({
  type: "agent.document.default",
  label: "Default Data Loader",
  description: "Makes chunks with metadata from items or files, for a vector store",
  category: "integration",
  icon: "File01Icon",
  iconUrl: DOCUMENT_ICON,
  supplies: RAG_KIND.document,
  supplyPorts: [{ name: "textSplitter", kind: RAG_KIND.textSplitter, label: "Text Splitter" }],
  config: z.object({
    dataType: z
      .enum(["json", "binary"])
      .default("json")
      .meta({
        title: "Type of Data",
        labels: { json: "JSON", binary: "Binary" },
        hints: { json: "The data of the items", binary: "A file of each item" },
      }),
    mode: z
      .enum(["all", "specific"])
      .default("all")
      .meta({
        showWhen: { dataType: ["json"] },
        title: "Mode",
        labels: { all: "Load All Input Data", specific: "Load Specific Data" },
        hints: {
          all: "All fields of each item, one line for each value",
          specific: "A text that you write with expressions",
        },
      }),
    text: z
      .string()
      .default("")
      .meta({
        ui: "textarea",
        showWhen: { dataType: ["json"], mode: ["specific"] },
        title: "Data",
        description: "The text of each item, such as {{ $json.title }}: {{ $json.body }}",
      }),
    binaryProperty: z
      .string()
      .default("data")
      .meta({
        showWhen: { dataType: ["binary"] },
        title: "Input Data Field Name",
        description: "The binary field of each item that has the file",
      }),
    format: z
      .enum(FORMATS)
      .default("auto")
      .meta({
        showWhen: { dataType: ["binary"] },
        title: "Data Format",
        labels: {
          auto: "Automatically Detect by MIME Type",
          pdf: "PDF",
          text: "Text",
          markdown: "Markdown",
          html: "HTML",
          json: "JSON",
        },
        hints: { auto: "Other files are read as text" },
      }),
    metadataFields: z.string().default("").meta({
      title: "Metadata Fields",
      description: "Optional. Fields of each item to keep with its chunks, with commas between",
    }),
    metadata: z.string().default("").meta({
      ui: "code",
      title: "Extra Metadata",
      placeholder: '{"source": "{{ $json.url }}"}',
      description: "Optional. A JSON object for each item. It can read the item",
    }),
  }),
  defaultConfig: {
    dataType: "json",
    mode: "all",
    text: "",
    binaryProperty: "data",
    format: "auto",
    metadataFields: "",
    metadata: "",
  },
  // These keys read one item, so the loader resolves them for each item.
  rawConfigKeys: ["text", "metadata"],
  subtitle: (config) => (config.dataType === "binary" ? "binary" : undefined),
  supply: (context) => {
    const { config, scope } = context;
    if (config.dataType === "json" && config.mode === "specific" && !config.text.trim()) {
      throw new Error('The node needs "text"');
    }
    const splitter = supplyOn(
      suppliesOf(context),
      "textSplitter",
      "Text Splitter",
      isTextSplitter,
      "a text splitter",
    );
    return documentLoader(
      {
        dataType: config.dataType,
        mode: config.mode,
        text: config.text,
        binaryProperty: config.binaryProperty.trim() || "data",
        format: config.format,
        metadataFields: config.metadataFields
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean),
        metadata: config.metadata,
        scope: isRecord(scope) ? scope : {},
      },
      splitter,
    );
  },
});
