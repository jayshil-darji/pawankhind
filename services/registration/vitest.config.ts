import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: "./",
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts", "test/**/*.int-spec.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
