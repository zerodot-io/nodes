// SPDX-License-Identifier: AGPL-3.0-only
import { PDFDocument, type PDFFont, rgb, StandardFonts } from "@cantoo/pdf-lib";

export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
} as const;

export type PageSize = keyof typeof PAGE_SIZES;

const MARGIN = 56;
const LINE_HEIGHT = 1.4;

/** Standard fonts cannot draw every character. Swap the ones they cannot draw for "?". */
function drawable(text: string, font: PDFFont): string {
  const known = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\t/g, "    "), (char) =>
    known.has(char.codePointAt(0) ?? 0) ? char : "?",
  ).join("");
}

/** Break one paragraph into lines that fit the width. A word that is too long is cut. */
function wrap(paragraph: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.split(/ +/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  lines.push(line);
  return lines;
}

export interface CreateOptions {
  content: string;
  title: string;
  author: string;
  pageSize: PageSize;
  fontSize: number;
}

/** Make a new PDF from plain text. A line break starts a new line. The text flows to new pages. */
export async function createPdf(options: CreateOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [pageWidth, pageHeight] = PAGE_SIZES[options.pageSize];
  const width = pageWidth - MARGIN * 2;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - MARGIN;
  const write = (line: string, font: PDFFont, size: number) => {
    const step = size * LINE_HEIGHT;
    if (y - step < MARGIN) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - MARGIN;
    }
    y -= step;
    if (line) page.drawText(line, { x: MARGIN, y, size, font, color: rgb(0.1, 0.1, 0.1) });
  };

  if (options.title) {
    const size = Math.round(options.fontSize * 1.8);
    for (const line of wrap(
      drawable(options.title.replace(/\s+/g, " "), bold),
      bold,
      size,
      width,
    )) {
      write(line, bold, size);
    }
    y -= options.fontSize;
  }
  for (const paragraph of options.content.split(/\r?\n/)) {
    for (const line of wrap(drawable(paragraph, regular), regular, options.fontSize, width)) {
      write(line, regular, options.fontSize);
    }
  }

  if (options.title) doc.setTitle(options.title);
  if (options.author) doc.setAuthor(options.author);
  return await doc.save();
}
