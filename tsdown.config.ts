import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "server/index": "src/server/index.ts",
  },
  format: "esm",
  // No runtime dependencies and no Node-only imports in either entry — the
  // client entry must stay loadable in browsers, and the server entry only
  // type-imports from agent-cli-runner.
  platform: "neutral",
  deps: { neverBundle: ["agent-cli-runner"] },
  dts: true,
  clean: true,
  sourcemap: true,
});
