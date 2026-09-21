import { defineConfig } from "tsup";

// GitHub runs actions straight from the repository without installing dependencies,
// so everything is bundled into a single CommonJS file.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  noExternal: [/.*/],
  platform: "node",
  target: "node20",
  clean: true,
});
