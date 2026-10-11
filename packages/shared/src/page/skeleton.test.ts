// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { MIN_SKELETON_TAGS, pageFingerprint, pageSkeleton, skeletonHash } from "./skeleton.ts";

const page = (body: string) => {
  const doc = document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = body;
  return doc;
};
const filler = (n: number) => "<div><span>x</span></div>".repeat(n);

describe("pageSkeleton", () => {
  it("keeps only tag names in document order", () => {
    const doc = page(
      `<form id="a" class="b"><input name="u"><button>Go</button></form>${filler(8)}`,
    );
    expect(pageSkeleton(doc)?.split(" ").slice(0, 4)).toEqual(["form", "input", "button", "div"]);
  });

  it("ignores text, attributes, scripts, line breaks and injected custom elements", () => {
    const a = page(`<p class="x">Hello<br>there</p><script>var a=1</script>${filler(8)}`);
    const b = page(
      `<p id="y">Bonjour</p><style>p{}</style><noscript><img></noscript><grammarly-extension><div></div></grammarly-extension>${filler(8)}`,
    );
    expect(pageSkeleton(a)).toBe(pageSkeleton(b));
  });

  it("counts an svg as one element", () => {
    const doc = page(`<svg><path d="M0"></path><g></g></svg>${filler(8)}`);
    expect(pageSkeleton(doc)?.startsWith("svg div span")).toBe(true);
  });

  it("returns null for pages too small to fingerprint", () => {
    expect(pageSkeleton(page("<form><input><input></form>"))).toBeNull();
    const tags = Math.ceil(MIN_SKELETON_TAGS / 2);
    expect(pageSkeleton(page(filler(tags)))).not.toBeNull();
  });
});

describe("skeletonHash", () => {
  it("is 16 hex characters and stable", async () => {
    const h = await skeletonHash("div span");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(await skeletonHash("div span")).toBe(h);
    expect(await skeletonHash("div p")).not.toBe(h);
  });

  it("fingerprints a page, or returns null when it is too small", async () => {
    expect(await pageFingerprint(page(filler(10)))).toMatch(/^[0-9a-f]{16}$/);
    expect(await pageFingerprint(page("<p></p>"))).toBeNull();
  });
});
