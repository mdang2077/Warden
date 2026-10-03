import { describe, expect, it } from "vitest";
import { shouldEvaluate } from "./navigation.ts";

describe("shouldEvaluate", () => {
  it.each([
    "https://example.com/login",
    "http://phish.example/path?q=1",
    "https://8.8.8.8/",
    "https://[2001:4860:4860::8888]/",
    "https://172.32.0.1/", // just outside 172.16/12
    "https://localhost.example.com/",
  ])("evaluates %s", (url) => {
    expect(shouldEvaluate(url)).toBe(true);
  });

  it.each([
    "chrome://settings",
    "chrome-extension://abcdef/warning.html",
    "file:///Users/me/page.html",
    "about:blank",
    "data:text/html,hi",
    "javascript:alert(1)",
    "not a url",
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://0x7f.0.0.1/", // hex form, normalized by URL to 127.0.0.1
    "http://2130706433/", // decimal form of 127.0.0.1
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
  ])("skips %s", (url) => {
    expect(shouldEvaluate(url)).toBe(false);
  });
});
