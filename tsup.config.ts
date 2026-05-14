import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
    env: "src/env.ts",
  },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts", env: "src/env.ts" } },
  clean: true,
  splitting: false,
  sourcemap: true,
  target: "node20",
  treeshake: true,
});
