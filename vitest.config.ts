import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Resolve workspace packages to their sources so tests never depend on a prior build.
export default defineConfig({
  resolve: {
    alias: {
      "@edgaragg/trazo-core": src("./packages/core/src/index.ts"),
      "@edgaragg/trazo-cli": src("./packages/cli/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
