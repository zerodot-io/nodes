// SPDX-License-Identifier: AGPL-3.0-only
import { type CallOptions, callNotion, MAX_ITEMS, type NotionAccess } from "./api";
import { isObject, type Json } from "./simplify";

/** The number of reads that run at the same time. */
const CONCURRENCY = 3;
/** The time limit for all the nested reads, in milliseconds. */
const DEADLINE_MS = 60_000;
const RETRIES = 2;

/**
 * Adds `children` to each block that has children. It reads `maxDepth` levels below the
 * first level at most. It makes at most `MAX_ITEMS` API calls and reads at most `MAX_ITEMS`
 * nested blocks. It stops at the deadline too.
 * A block that was not read (depth, budget or deadline) has `truncated: true`.
 * Then "no children" (no key) differs from "not read".
 * `shape` makes the final form of each block (the simple form, or the raw block).
 */
export async function withChildren(
  access: NotionAccess,
  blocks: unknown[],
  maxDepth: number,
  shape: (block: unknown) => unknown,
  options: CallOptions,
  limits: { deadlineMs?: number; concurrency?: number } = {},
): Promise<unknown[]> {
  let calls = MAX_ITEMS;
  let items = MAX_ITEMS;
  const deadline = Date.now() + (limits.deadlineMs ?? DEADLINE_MS);
  const readOptions: CallOptions = { ...options, retries: options.retries ?? RETRIES };

  // A small pool: at most `size` reads at once.
  const size = limits.concurrency ?? CONCURRENCY;
  let running = 0;
  const waiting: (() => void)[] = [];
  const slot = async () => {
    if (running >= size) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
  };
  const free = () => {
    running--;
    waiting.shift()?.();
  };

  /** All the children of a block, or `null` when a limit stopped the read. */
  const read = async (id: string): Promise<unknown[] | null> => {
    const out: unknown[] = [];
    let cursor: string | undefined;
    for (;;) {
      if (calls <= 0 || items <= 0 || Date.now() >= deadline) return null;
      calls--;
      await slot();
      let page: Awaited<ReturnType<typeof callNotion>>;
      try {
        page = await callNotion(
          access,
          {
            method: "GET",
            path: `/v1/blocks/${id}/children`,
            query: { start_cursor: cursor, page_size: Math.min(100, items) },
          },
          readOptions,
        );
      } finally {
        free();
      }
      const results = Array.isArray(page.results) ? page.results : [];
      const take = results.slice(0, items);
      items -= take.length;
      out.push(...take);
      if (take.length < results.length) return null;
      if (!page.has_more || typeof page.next_cursor !== "string" || page.next_cursor === "") {
        return out;
      }
      cursor = page.next_cursor;
    }
  };

  const walk = async (level: unknown[], depth: number): Promise<unknown[]> =>
    await Promise.all(
      level.map(async (block): Promise<unknown> => {
        const shaped = shape(block);
        if (!isObject(block) || !isObject(shaped) || block.has_children !== true) return shaped;
        if (depth >= maxDepth || typeof block.id !== "string") {
          return { ...shaped, truncated: true } satisfies Json;
        }
        const children = await read(block.id);
        if (children === null) return { ...shaped, truncated: true } satisfies Json;
        return { ...shaped, children: await walk(children, depth + 1) } satisfies Json;
      }),
    );
  return await walk(blocks, 0);
}
