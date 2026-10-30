// SPDX-License-Identifier: AGPL-3.0-only
import { degrees, PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { defineNode, type NodeResult, readBinary, toBinary } from "@zerodot/node-sdk";
import { z } from "zod";
import { createPdf } from "./create";
import { PDF_ICON } from "./icon";
import { parsePages } from "./pages";

const OPERATIONS = [
  "create",
  "info",
  "text",
  "merge",
  "pages",
  "split",
  "rotate",
  "watermark",
  "numbers",
  "metadata",
  "unlock",
  "protect",
] as const;
const ALL_FILES = [
  "info",
  "text",
  "pages",
  "split",
  "rotate",
  "watermark",
  "numbers",
  "metadata",
  "unlock",
  "protect",
];
const NEW_FILE = [
  "create",
  "merge",
  "pages",
  "split",
  "rotate",
  "watermark",
  "numbers",
  "metadata",
  "unlock",
  "protect",
];

const config = z.object({
  operation: z
    .enum(OPERATIONS)
    .default("text")
    .meta({
      title: "Operation",
      labels: {
        create: "Create from Text",
        info: "Get Information",
        text: "Extract Text",
        merge: "Merge Files",
        pages: "Pick Pages",
        split: "Split",
        rotate: "Rotate Pages",
        watermark: "Add Watermark",
        numbers: "Add Page Numbers",
        metadata: "Set Information",
        unlock: "Remove Password",
        protect: "Add Password",
      },
      hints: {
        create: "Make a new PDF file from text",
        info: "Get the page count, title, and author of the file",
        text: "Read the text of the file",
        merge: "Join many PDF files into one file",
        pages: "Make a new file with some of the pages",
        split: "Cut the file into smaller files",
        rotate: "Turn pages by an angle",
        watermark: "Write a text over the pages",
        numbers: "Write the page number at the bottom of each page",
        metadata: "Set the title, author, subject, and keywords",
        unlock: "Save a copy of the file that has no password. You must know the password.",
        protect: "Save a copy of the file that needs a password to open",
      },
    }),
  property: z
    .string()
    .min(1)
    .default("data")
    .meta({
      title: "Input Binary Field",
      description: "The PDF is in binary.<property> of the input",
      showWhen: { operation: ALL_FILES },
    }),
  properties: z
    .string()
    .min(1)
    .default("data")
    .meta({
      title: "Input Binary Fields",
      description: "Names of the fields with the PDF files, in order. Split with commas.",
      showWhen: { operation: ["merge"] },
    }),
  outputProperty: z
    .string()
    .min(1)
    .default("data")
    .meta({
      title: "Output Binary Field",
      description: "The new file goes to binary.<property> of the output",
      showWhen: { operation: NEW_FILE },
    }),
  pages: z
    .string()
    .default("")
    .meta({
      title: "Pages",
      description:
        "Pages count from 1. Example: 1-3, 5, 8-. Empty means all pages, except for Pick Pages.",
      showWhen: { operation: ["pages", "rotate", "watermark", "numbers"] },
    }),
  content: z
    .string()
    .default("")
    .meta({
      title: "Content",
      description: "The text of the file. A line break starts a new line.",
      ui: "textarea",
      showWhen: { operation: ["create"] },
    }),
  pageSize: z
    .enum(["a4", "letter"])
    .default("a4")
    .meta({
      title: "Page Size",
      labels: { a4: "A4", letter: "Letter" },
      showWhen: { operation: ["create"] },
    }),
  bodySize: z
    .number()
    .int()
    .min(6)
    .max(48)
    .default(12)
    .meta({
      title: "Font Size",
      showWhen: { operation: ["create"] },
    }),
  pagesPerFile: z
    .number()
    .int()
    .min(1)
    .default(1)
    .meta({
      title: "Pages per File",
      description: "The output fields are named <property>_1, <property>_2, and so on",
      showWhen: { operation: ["split"] },
    }),
  degrees: z
    .enum(["90", "180", "270"])
    .default("90")
    .meta({
      title: "Degrees",
      description: "Clockwise",
      labels: { "90": "90", "180": "180", "270": "270" },
      hints: { "90": "Quarter turn", "180": "Upside down", "270": "Quarter turn, other way" },
      showWhen: { operation: ["rotate"] },
    }),
  password: z
    .string()
    .default("")
    .meta({
      title: "Password",
      description: "The password to open the file. Leave empty if the file has no password.",
      showWhen: { operation: [...ALL_FILES, "merge"] },
    }),
  newPassword: z
    .string()
    .default("")
    .meta({
      title: "New Password",
      description: "People must type this password to open the new file",
      showWhen: { operation: ["protect"] },
    }),
  text: z
    .string()
    .default("")
    .meta({
      title: "Text",
      showWhen: { operation: ["watermark"] },
    }),
  fontSize: z
    .number()
    .int()
    .min(4)
    .max(400)
    .default(60)
    .meta({
      title: "Font Size",
      showWhen: { operation: ["watermark"] },
    }),
  title: z
    .string()
    .default("")
    .meta({
      title: "Title",
      description: "Empty keeps the old value. For a new file, it is also the heading.",
      showWhen: { operation: ["create", "metadata"] },
    }),
  author: z
    .string()
    .default("")
    .meta({
      title: "Author",
      description: "Empty keeps the old value",
      showWhen: { operation: ["create", "metadata"] },
    }),
  subject: z
    .string()
    .default("")
    .meta({
      title: "Subject",
      description: "Empty keeps the old value",
      showWhen: { operation: ["metadata"] },
    }),
  keywords: z
    .string()
    .default("")
    .meta({
      title: "Keywords",
      description: "Split with commas. Empty keeps the old value.",
      showWhen: { operation: ["metadata"] },
    }),
});

/**
 * The library writes a file that it opened with a password with the password again. A copy of
 * the pages in a new file has no password.
 */
async function withoutPassword(doc: PDFDocument): Promise<PDFDocument> {
  const plain = await PDFDocument.create();
  for (const page of await plain.copyPages(doc, doc.getPageIndices())) plain.addPage(page);
  const keywords = doc.getKeywords();
  plain.setTitle(doc.getTitle() ?? "");
  plain.setAuthor(doc.getAuthor() ?? "");
  plain.setSubject(doc.getSubject() ?? "");
  if (keywords) plain.setKeywords([keywords]);
  return plain;
}

async function load(bytes: Uint8Array, password: string): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { password: password || undefined });
  } catch (error) {
    if (/password|encrypt/i.test(error instanceof Error ? error.message : "")) {
      throw new Error("The PDF needs a password, or the password is wrong");
    }
    throw new Error("The binary data is not a PDF file that this node can read");
  }
  return password ? await withoutPassword(doc) : doc;
}

function stemOf(fileName: string | undefined): string {
  return (fileName ?? "document").replace(/\.[^.]+$/, "");
}

export default defineNode({
  type: "file.pdf",
  label: "PDF",
  description: "Create, read, merge, split, and rotate PDF files",
  category: "data",
  actions: [
    { label: "Create a PDF from text", config: { operation: "create" } },
    { label: "Extract text from a PDF", config: { operation: "text" } },
    { label: "Get information about a PDF", config: { operation: "info" } },
    { label: "Merge PDF files", config: { operation: "merge" } },
    { label: "Pick pages from a PDF", config: { operation: "pages" } },
    { label: "Split a PDF", config: { operation: "split" } },
    { label: "Rotate pages of a PDF", config: { operation: "rotate" } },
    { label: "Add a watermark to a PDF", config: { operation: "watermark" } },
    { label: "Add page numbers to a PDF", config: { operation: "numbers" } },
    { label: "Set the title and author of a PDF", config: { operation: "metadata" } },
    { label: "Remove the password from a PDF", config: { operation: "unlock" } },
    { label: "Add a password to a PDF", config: { operation: "protect" } },
  ],
  icon: "File01Icon",
  iconUrl: PDF_ICON,
  config,
  defaultConfig: {
    operation: "text",
    property: "data",
    properties: "data",
    outputProperty: "data",
    pages: "",
    content: "",
    pageSize: "a4",
    bodySize: 12,
    pagesPerFile: 1,
    degrees: "90",
    password: "",
    newPassword: "",
    text: "",
    fontSize: 60,
    title: "",
    author: "",
    subject: "",
    keywords: "",
  },
  ports: { in: ["in"], out: ["out"] },
  subtitle: (cfg) => (typeof cfg.operation === "string" ? cfg.operation : undefined),
  async run({ config: cfg, input }) {
    if (cfg.operation === "create") {
      if (!cfg.content.trim() && !cfg.title.trim()) throw new Error("Add the content of the file");
      const bytes = await createPdf({
        content: cfg.content,
        title: cfg.title,
        author: cfg.author,
        pageSize: cfg.pageSize,
        fontSize: cfg.bodySize,
      });
      return {
        port: "out",
        data: {
          binary: {
            [cfg.outputProperty]: toBinary(bytes, "document.pdf", "application/pdf"),
          },
        },
      };
    }

    if (cfg.operation === "merge") {
      const names = cfg.properties
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      if (names.length < 2) throw new Error("Add the names of at least two binary fields");
      const merged = await PDFDocument.create();
      const stem = "merged";
      for (const name of names) {
        const file = readBinary(input, name);
        const doc = await load(Buffer.from(file.data, "base64"), cfg.password);
        const copied = await merged.copyPages(doc, doc.getPageIndices());
        for (const page of copied) merged.addPage(page);
      }
      return {
        port: "out",
        data: {
          binary: {
            [cfg.outputProperty]: toBinary(await merged.save(), `${stem}.pdf`, "application/pdf"),
          },
        },
      };
    }

    const file = readBinary(input, cfg.property);
    const bytes = Buffer.from(file.data, "base64");
    const stem = stemOf(file.fileName);

    if (cfg.operation === "text") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
      try {
        pdf = await getDocumentProxy(new Uint8Array(bytes), {
          password: cfg.password || undefined,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "PasswordException") {
          throw new Error("The PDF needs a password, or the password is wrong");
        }
        throw new Error("The binary data is not a PDF file that this node can read");
      }
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      return {
        port: "out",
        data: { text: text.join("\n\n"), pages: text, totalPages },
      };
    }

    const doc = await load(bytes, cfg.password);
    const total = doc.getPageCount();

    if (cfg.operation === "info") {
      return {
        port: "out",
        data: {
          pages: total,
          title: doc.getTitle() ?? null,
          author: doc.getAuthor() ?? null,
          subject: doc.getSubject() ?? null,
          creator: doc.getCreator() ?? null,
          producer: doc.getProducer() ?? null,
          size: bytes.length,
        },
      };
    }

    if (cfg.operation === "rotate") {
      const indexes = cfg.pages.trim() ? parsePages(cfg.pages, total) : doc.getPageIndices();
      const pages = doc.getPages();
      for (const index of indexes) {
        const page = pages[index];
        if (!page) continue;
        page.setRotation(degrees((page.getRotation().angle + Number(cfg.degrees)) % 360));
      }
      return {
        port: "out",
        data: {
          binary: {
            [cfg.outputProperty]: toBinary(await doc.save(), `${stem}.pdf`, "application/pdf"),
          },
        },
      };
    }

    const send = async (): Promise<NodeResult> => ({
      port: "out",
      data: {
        binary: {
          [cfg.outputProperty]: toBinary(await doc.save(), `${stem}.pdf`, "application/pdf"),
        },
      },
    });
    const target = () => (cfg.pages.trim() ? parsePages(cfg.pages, total) : doc.getPageIndices());

    if (cfg.operation === "unlock") {
      // A file with only an owner password opens with no password. Copy it to drop the lock too.
      const plain = await withoutPassword(doc);
      return {
        port: "out",
        data: {
          binary: {
            [cfg.outputProperty]: toBinary(await plain.save(), `${stem}.pdf`, "application/pdf"),
          },
        },
      };
    }

    if (cfg.operation === "protect") {
      if (!cfg.newPassword) throw new Error("Add a new password");
      doc.encrypt({ userPassword: cfg.newPassword, ownerPassword: cfg.newPassword });
      return await send();
    }

    if (cfg.operation === "metadata") {
      if (cfg.title) doc.setTitle(cfg.title);
      if (cfg.author) doc.setAuthor(cfg.author);
      if (cfg.subject) doc.setSubject(cfg.subject);
      if (cfg.keywords) {
        doc.setKeywords(
          cfg.keywords
            .split(",")
            .map((word) => word.trim())
            .filter(Boolean),
        );
      }
      return await send();
    }

    if (cfg.operation === "watermark") {
      if (!cfg.text) throw new Error("Add the text of the watermark");
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const pages = doc.getPages();
      for (const index of target()) {
        const page = pages[index];
        if (!page) continue;
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(cfg.text, cfg.fontSize);
        // Center the text on the page, turned 45 degrees about its own middle.
        const angle = Math.PI / 4;
        page.drawText(cfg.text, {
          x: width / 2 - (textWidth / 2) * Math.cos(angle),
          y: height / 2 - (textWidth / 2) * Math.sin(angle),
          size: cfg.fontSize,
          font,
          color: rgb(0.5, 0.5, 0.5),
          opacity: 0.3,
          rotate: degrees(45),
        });
      }
      return await send();
    }

    if (cfg.operation === "numbers") {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();
      for (const index of target()) {
        const page = pages[index];
        if (!page) continue;
        const label = `${index + 1} / ${total}`;
        const size = 10;
        page.drawText(label, {
          x: page.getWidth() / 2 - font.widthOfTextAtSize(label, size) / 2,
          y: 20,
          size,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
      return await send();
    }

    const out = async (indexes: number[]): Promise<Uint8Array> => {
      const part = await PDFDocument.create();
      for (const page of await part.copyPages(doc, indexes)) part.addPage(page);
      return await part.save();
    };

    if (cfg.operation === "pages") {
      const indexes = parsePages(cfg.pages, total);
      return {
        port: "out",
        data: {
          binary: {
            [cfg.outputProperty]: toBinary(await out(indexes), `${stem}.pdf`, "application/pdf"),
          },
        },
      };
    }

    // split
    const binary: Record<string, ReturnType<typeof toBinary>> = {};
    const count = Math.ceil(total / cfg.pagesPerFile);
    for (let part = 0; part < count; part++) {
      const start = part * cfg.pagesPerFile;
      const indexes = doc.getPageIndices().slice(start, start + cfg.pagesPerFile);
      binary[`${cfg.outputProperty}_${part + 1}`] = toBinary(
        await out(indexes),
        `${stem}-${part + 1}.pdf`,
        "application/pdf",
      );
    }
    return { port: "out", data: { binary, files: count } };
  },
});
