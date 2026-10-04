// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { extractSnapshot, hasSecretSurface } from "./extract.ts";

/** An inert parsed document: no scripts run and no subresources load. */
function page(html: string, url = "https://login.example.com/signin") {
  const doc = new DOMParser().parseFromString(`<!doctype html><html>${html}</html>`, "text/html");
  Object.defineProperty(doc, "URL", { value: url });
  Object.defineProperty(doc, "location", { value: new URL(url) });
  return doc;
}

describe("credential gate", () => {
  it("fires on a visible password field and records the form", () => {
    const snap = extractSnapshot(
      page(`<head><title>Sign in</title></head><body>
        <form action="/session" method="POST">
          <label for="u">Email</label><input id="u" name="email" type="email">
          <label>Password <input name="pw" type="password"></label>
          <input type="hidden" name="csrf" value="x"><button>Go</button>
        </form></body>`),
    );
    expect(hasSecretSurface(snap)).toBe(true);
    expect(snap.secrets).toEqual({ password: 1, otp: 0, card: 0, seed: 0 });
    expect(snap.title).toBe("Sign in");
    const form = snap.forms[0];
    expect(form).toMatchObject({
      action: "https://login.example.com/session",
      method: "post",
      loose: false,
    });
    expect(form?.fields.map((f) => [f.name, f.label, f.secret])).toEqual([
      ["email", "Email", null],
      ["pw", "Password", "password"],
    ]);
  });

  it("ignores hidden password fields (autofill traps)", () => {
    const snap = extractSnapshot(
      page(`<body><form>
        <input type="password" style="display:none">
        <div hidden><input type="password"></div>
        <input type="password" style="visibility:hidden">
        <input name="q" type="search"></form></body>`),
    );
    expect(hasSecretSurface(snap)).toBe(false);
  });

  it("detects OTP fields by autocomplete, hints, and split boxes", () => {
    const byHint = extractSnapshot(
      page(`<body><form><input autocomplete="one-time-code"><input name="sms_code"></form></body>`),
    );
    expect(byHint.secrets.otp).toBe(2);
    const split = extractSnapshot(
      page(`<body><form>${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</form></body>`),
    );
    expect(split.secrets.otp).toBe(6);
    const notSplit = extractSnapshot(
      page(`<body><form>${'<input maxlength="1">'.repeat(2)}</form></body>`),
    );
    expect(notSplit.secrets.otp).toBe(0);
  });

  it("detects card fields", () => {
    const snap = extractSnapshot(
      page(`<body><form>
        <input autocomplete="cc-number"><input name="cvv" type="password">
        <label for="e">Expiration date</label><input id="e"></form></body>`),
    );
    expect(snap.secrets).toMatchObject({ card: 3, password: 0 });
  });

  it("detects a seed-phrase grid", () => {
    const boxes = Array.from({ length: 12 }, (_, i) => `<input placeholder="${i + 1}">`).join("");
    const snap = extractSnapshot(
      page(`<body><h1>Enter your recovery phrase</h1><form>${boxes}</form></body>`),
    );
    expect(snap.secrets.seed).toBe(12);
    const noPhrase = extractSnapshot(page(`<body><h1>Survey</h1><form>${boxes}</form></body>`));
    expect(noPhrase.secrets.seed).toBe(0);
  });

  it("collects fields outside any form", () => {
    const snap = extractSnapshot(page(`<body><input type="password" aria-label="PIN"></body>`));
    expect(snap.forms).toHaveLength(1);
    expect(snap.forms[0]).toMatchObject({ loose: true, action: "" });
    expect(hasSecretSurface(snap)).toBe(true);
  });

  it("does not fire on pages without secrets", () => {
    const snap = extractSnapshot(
      page(`<body><form action="/search"><input name="q"></form><p>News</p></body>`),
    );
    expect(hasSecretSurface(snap)).toBe(false);
  });
});

describe("page details", () => {
  it("resolves URLs and counts links, scripts, iframes, and meta refresh", () => {
    const snap = extractSnapshot(
      page(`<head>
        <link rel="icon" href="/static/fav.png">
        <meta http-equiv="Refresh" content="0; url=https://elsewhere.example/">
        <script src="https://cdn.example/a.js"></script><script>var x=1</script>
      </head><body>
        <img src="/img/brand-logo.svg" alt="Microsoft"><img src="/photo.jpg">
        <a href="/help">Help</a><a href="https://other.example/">Out</a><a href="#">x</a>
        <a href="javascript:void(0)">y</a><iframe src="https://frame.example/f"></iframe>
      </body>`),
    );
    expect(snap.favicon).toBe("https://login.example.com/static/fav.png");
    expect(snap.logoCandidates).toEqual(["https://login.example.com/img/brand-logo.svg"]);
    expect(snap.links).toEqual({ total: 4, external: 1, empty: 2 });
    expect(snap.scripts).toEqual({ inline: 1, external: ["https://cdn.example/a.js"] });
    expect(snap.iframes).toEqual(["https://frame.example/f"]);
    expect(snap.metaRefresh).toBe("0; url=https://elsewhere.example/");
  });

  it("falls back to /favicon.ico and caps long text", () => {
    const snap = extractSnapshot(page(`<body><p>${"word ".repeat(10_000)}</p></body>`));
    expect(snap.favicon).toBe("https://login.example.com/favicon.ico");
    expect(snap.text.length).toBe(20_000);
  });

  it("caps the number of fields per form", () => {
    const snap = extractSnapshot(page(`<body><form>${"<input>".repeat(500)}</form></body>`));
    expect(snap.forms[0]?.fields).toHaveLength(50);
  });
});
