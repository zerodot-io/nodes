// SPDX-License-Identifier: AGPL-3.0-only

/** Turn "1-3, 5, 8-" into zero-based page indexes. Pages count from 1. */
export function parsePages(text: string, total: number): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(item);
    if (!match || (!match[1] && !match[3])) throw new Error(`"${item}" is not a page range`);
    const from = match[1] ? Number(match[1]) : 1;
    const to = match[2] ? (match[3] ? Number(match[3]) : total) : from;
    if (from < 1 || to < from || to > total) {
      throw new Error(`The range "${item}" is outside the file (${total} pages)`);
    }
    for (let page = from; page <= to; page++) out.push(page - 1);
  }
  if (out.length === 0) throw new Error("Add the pages to use");
  return out;
}
