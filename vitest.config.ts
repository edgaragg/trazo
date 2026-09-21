import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Resolve workspace packages to their sources so tests never depend on a prior build.
export default defineConfig({
  resolve: {
    alias: {
      "@trazo/core": src("./packages/core/src/index.ts"),
      trazo: src("./packages/cli/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
