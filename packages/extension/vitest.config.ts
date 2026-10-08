import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "extension",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
