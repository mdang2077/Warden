import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  imports: false,
  // Store builds (`wxt build` / `wxt zip`, mode "production") leave out `downloads`: it adds a
  // "Manage your downloads" install warning, and experiment H9 that uses it is log-only.
  // Development and e2e builds keep it so H9 can be tried and tested.
  manifest: ({ mode }) => ({
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
      ...(mode === "production" ? [] : ["downloads"]),
    ],
    host_permissions: ["<all_urls>"],
    // DNR redirect rules point at the interstitial, so it must be web-accessible.
    web_accessible_resources: [{ resources: ["warning.html"], matches: ["<all_urls>"] }],
  }),
});
