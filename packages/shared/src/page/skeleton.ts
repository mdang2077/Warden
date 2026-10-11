/**
 * Page skeleton (S2.9): the page's element tags in document order, with no text, attributes
 * or classes, as a short hash. Phishing kits are deployed unchanged on many sites, so their
 * pages share a skeleton while their text, URLs and assets differ.
 *
 * Runs on a live document (content script) and on a saved page parsed by happy-dom (eval),
 * so it only reads what both agree on: element names under <body>.
 */

/** Subtrees whose inside says nothing about the page layout (or isn't parsed the same). */
const SKIP_SUBTREE = new Set(["script", "style", "noscript", "template", "svg", "math"]);
/** Elements whose count depends on line wrapping or tracking, not on the kit. */
const SKIP_ELEMENT = new Set(["br", "wbr"]);
/** Pages with fewer tags than this are too generic to fingerprint (blank, one form). */
export const MIN_SKELETON_TAGS = 15;
const MAX_SKELETON_TAGS = 4_000;

/**
 * The tag sequence, or null for a page too small to tell apart from others. Custom elements
 * (`<grammarly-extension>`, names with a dash) are skipped: browser extensions inject them
 * into live pages, which would make a user's page differ from the crawled kit.
 */
export function pageSkeleton(doc: Document): string | null {
  const body = doc.body;
  if (!body) return null;
  const tags: string[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (tags.length >= MAX_SKELETON_TAGS) return;
      const tag = child.localName.toLowerCase();
      if (tag.includes("-")) continue;
      if (SKIP_SUBTREE.has(tag)) {
        if (tag === "svg") tags.push(tag);
        continue;
      }
      if (!SKIP_ELEMENT.has(tag)) tags.push(tag);
      walk(child);
    }
  };
  walk(body);
  return tags.length >= MIN_SKELETON_TAGS ? tags.join(" ") : null;
}

/** First 16 hex characters of the skeleton's SHA-256. */
export async function skeletonHash(skeleton: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(skeleton));
  let hex = "";
  for (const b of new Uint8Array(digest).slice(0, 8)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export async function pageFingerprint(doc: Document): Promise<string | null> {
  const skeleton = pageSkeleton(doc);
  return skeleton ? skeletonHash(skeleton) : null;
}
