import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shared",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
