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
      // Forced-download guard (H9): pauses a download the page forced and asks Keep/Cancel.
      "downloads",
    ],
    host_permissions: ["<all_urls>"],
    // DNR redirect rules point at the interstitial, so it must be web-accessible.
    web_accessible_resources: [{ resources: ["warning.html"], matches: ["<all_urls>"] }],
  },
});
