import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shared",
    passWithNoTests: true,
    // DOM tests must never touch the network: fixtures reference made-up hosts.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableIframePageLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableCSSFileLoading: true,
        },
      },
    },
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
