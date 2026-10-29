// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

export const OPERATIONS = ["generate", "get", "cancel", "delete"] as const;
export type Operation = (typeof OPERATIONS)[number];

const isGenerate = { showWhen: { operation: ["generate"] } };
const hasRequestId = { showWhen: { operation: ["get", "cancel", "delete"] } };

export const higgsfieldConfig = z.object({
  operation: z
    .enum(OPERATIONS)
    .default("generate")
    .meta({
      labels: { generate: "Generate", get: "Get", cancel: "Cancel", delete: "Delete" },
      hints: {
        generate: "Start an image or video with a model, and wait for the files",
        get: "Get the status and the files of a request",
        cancel: "Stop a request that waits in the queue",
        delete: "Delete the files and the prompt of a finished request",
      },
    }),
  model: z
    .string()
    .optional()
    .meta({
      ...isGenerate,
      description:
        "The path of the model, from Higgsfield Console. For example higgsfield-ai/soul/v2/standard or kling-video/v2.5-turbo/pro/text-to-video",
    }),
  prompt: z
    .string()
    .optional()
    .meta({
      ...isGenerate,
      ui: "textarea",
      description: "The text for the model. Models that need no prompt can leave it empty",
    }),
  parameters: z
    .string()
    .optional()
    .meta({
      ...isGenerate,
      ui: "code",
      description:
        'The other fields of the model as a JSON object, such as {"aspect_ratio":"16:9","duration":5}. A field here replaces the same field of the node',
    }),
  wait: z
    .boolean()
    .default(true)
    .meta({
      ...isGenerate,
      title: "Wait for the result",
      description: "Off: the node gives the request ID at once. Use Get later to read the result",
    }),
  waitTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(600_000)
    .meta({
      showWhen: { operation: ["generate"], wait: [true] },
      title: "Wait Timeout (ms)",
      description: "The most time to wait. The request goes on after this time",
    }),
  idempotencyKey: z
    .string()
    .optional()
    .meta({
      ...isGenerate,
      description:
        "Same key, same request: Higgsfield does not start a second one. Empty means a new random key for each run",
    }),
  requestId: z
    .string()
    .optional()
    .meta({
      ...hasRequestId,
      title: "Request ID",
      description: "The request_id that Generate gave",
    }),
  timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
});

export type HiggsfieldConfig = z.output<typeof higgsfieldConfig>;
