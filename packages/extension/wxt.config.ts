import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  imports: false,
  manifest: {
    name: "Warden",
    description: "Blocks known phishing pages and the popups and redirects that lead to them.",
    permissions: [
      "webNavigation",
      // Observe-only (no blocking): sees each server-redirect hop of a top-frame navigation.
      "webRequest",
      "tabs",
      "storage",
      "alarms",
      "declarativeNetRequest",
      "unlimitedStorage",
      // Log-only experiment H9: notices downloads a page forced (nothing is cancelled).
      "downloads",
    ],
    host_permissions: ["<all_urls>"],
    // DNR redirect rules point at the interstitial, so it must be web-accessible.
    web_accessible_resources: [{ resources: ["warning.html"], matches: ["<all_urls>"] }],
  },
});
