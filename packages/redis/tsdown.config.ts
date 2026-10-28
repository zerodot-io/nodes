import { defineConfig } from "tsdown";

// zerodot gives the SDK and zod. ioredis comes from this package.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  dts: false,
  clean: true,
  deps: { neverBundle: ["@zerodot/node-sdk", "zod", "ioredis"] },
});
