import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  imports: false,
  manifest: {
    name: "Warden",
    description: "Blocks known phishing pages using curated threat feeds.",
    permissions: [
      "webNavigation",
      "tabs",
      "storage",
      "alarms",
      "declarativeNetRequest",
      "unlimitedStorage",
    ],
    host_permissions: ["<all_urls>"],
    // DNR redirect rules point at the interstitial, so it must be web-accessible.
    web_accessible_resources: [{ resources: ["warning.html"], matches: ["<all_urls>"] }],
  },
});
