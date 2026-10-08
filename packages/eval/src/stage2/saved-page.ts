/**
 * Parses a crawl's saved page.html for offline Stage 2 reports. The HTML is attacker-
 * controlled, so scripts never run and subresources never load.
 *
 * One window per page, closed right after extraction: a single shared window keeps every
 * parsed document alive. `<link>` tags are stripped first: happy-dom preloads `rel=preload`
 * targets, which would fetch from the phish site (checked against happy-dom 20.14.5; no
 * other tag fetched with these settings). `body.innerText` is blanked so extractors fall
 * back to `textContent`: happy-dom's innerText can spin forever on some pages.
 */
import { Window } from "happy-dom";

export function parseSavedPage(
  html: string,
  url: string,
): { doc: Document; close: () => Promise<void> } {
  const inert = html.replace(/<link\b[^>]*>/gi, "");
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  const doc = new window.DOMParser().parseFromString(inert, "text/html") as unknown as Document;
  Object.defineProperty(doc, "URL", { value: url });
  Object.defineProperty(doc, "location", { value: new URL(url) });
  if (doc.body) Object.defineProperty(doc.body, "innerText", { get: () => "" });
  return { doc, close: () => window.happyDOM.close() };
}
