// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  type ClickMessage,
  createClickRelay,
  isStrictQuery,
  parseClickMessage,
  visibleLinkHref,
} from "./click-capture.ts";

function link(html: string): Element {
  document.body.innerHTML = html;
  return document.querySelector("#t") as Element;
}

describe("visibleLinkHref", () => {
  it("returns the resolved href of the link around the target", () => {
    const target = link('<a href="https://news.example/a"><span id="t">read</span></a>');
    expect(visibleLinkHref(target, window)).toBe("https://news.example/a");
  });

  it("returns null when there's no link", () => {
    expect(visibleLinkHref(link('<div id="t">video</div>'), window)).toBeNull();
    expect(visibleLinkHref(null, window)).toBeNull();
  });

  it("ignores near-transparent and hidden links, including through ancestors", () => {
    expect(
      visibleLinkHref(
        link('<a id="t" href="https://ads.example/" style="opacity:0">x</a>'),
        window,
      ),
    ).toBeNull();
    expect(
      visibleLinkHref(
        link('<div style="opacity:0.05"><a id="t" href="https://ads.example/">x</a></div>'),
        window,
      ),
    ).toBeNull();
    expect(
      visibleLinkHref(
        link('<a id="t" href="https://ads.example/" style="visibility:hidden">x</a>'),
        window,
      ),
    ).toBeNull();
  });

  it("ignores links covering most of the viewport", () => {
    const target = link('<a id="t" href="https://ads.example/">x</a>');
    target.getBoundingClientRect = () =>
      ({ width: window.innerWidth, height: window.innerHeight * 0.7 }) as DOMRect;
    expect(visibleLinkHref(target, window)).toBeNull();
  });
});

describe("click relay", () => {
  const msg = (at: number): ClickMessage => ({
    type: "warden:click",
    at,
    input: "pointer",
    linkHref: null,
  });

  it("buffers clicks made before the worker answers, then sends them on a strict site", () => {
    const sent: ClickMessage[] = [];
    const relay = createClickRelay((m) => sent.push(m));
    relay.record(msg(1));
    expect(sent).toEqual([]);
    relay.resolve(true);
    expect(sent).toEqual([msg(1)]);
    relay.record(msg(2));
    expect(sent).toEqual([msg(1), msg(2)]);
  });

  it("drops buffered clicks and sends nothing on a site that isn't strict", () => {
    const sent: ClickMessage[] = [];
    const relay = createClickRelay((m) => sent.push(m));
    relay.record(msg(1));
    relay.resolve(false);
    relay.record(msg(2));
    expect(sent).toEqual([]);
  });
});

describe("messages", () => {
  it("recognizes the strict query and parses click messages", () => {
    expect(isStrictQuery({ type: "warden:strict?" })).toBe(true);
    expect(isStrictQuery({ type: "warden:fields" })).toBe(false);
    expect(
      parseClickMessage({
        type: "warden:click",
        at: 5,
        input: "key",
        linkHref: "https://a.example/",
      }),
    ).toEqual({ at: 5, input: "key", linkHref: "https://a.example/" });
    expect(
      parseClickMessage({ type: "warden:click", at: "5", input: "key", linkHref: null }),
    ).toBeNull();
    expect(
      parseClickMessage({ type: "warden:click", at: 5, input: "mouse", linkHref: null }),
    ).toBeNull();
  });
});
