// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  askText,
  DOWNLOAD_ASK,
  DOWNLOAD_CHOICE,
  PROMPT_TAG,
  parseAsk,
  parseChoice,
  showDownloadPrompt,
} from "./download-prompt.ts";

const cards = () => [
  ...(document.querySelector(PROMPT_TAG)?.shadowRoot?.querySelectorAll(".card") ?? []),
];

describe("download prompt", () => {
  it("asks until the user picks, once, and shows names as text", () => {
    const choose = vi.fn();
    showDownloadPrompt(document, { id: 7, text: "<b>x</b> from evil.example" }, choose);
    const [card] = cards();
    expect(card?.textContent).toContain("<b>x</b> from evil.example");
    expect(card?.querySelector("b")).toBeNull();
    (card?.querySelector("button.cancel") as HTMLButtonElement).click();
    (card?.querySelector("button.keep") as HTMLButtonElement).click();
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith(false);
    expect(cards()).toHaveLength(0);
  });

  it("stacks one card per download", () => {
    const choose = vi.fn();
    showDownloadPrompt(document, { id: 1, text: "a" }, choose);
    showDownloadPrompt(document, { id: 2, text: "b" }, choose);
    expect(cards().map((c) => (c as HTMLElement).dataset.downloadId)).toEqual(["1", "2"]);
    (cards()[1]?.querySelector("button.keep") as HTMLButtonElement).click();
    expect(choose).toHaveBeenCalledWith(true);
  });

  it("validates messages", () => {
    expect(parseAsk({ type: DOWNLOAD_ASK, id: 3, text: "t" })).toEqual({
      type: DOWNLOAD_ASK,
      id: 3,
      text: "t",
    });
    expect(parseAsk({ type: DOWNLOAD_ASK, id: "3", text: "t" })).toBeNull();
    expect(parseChoice({ type: DOWNLOAD_CHOICE, id: 3, keep: false })).toEqual({
      type: DOWNLOAD_CHOICE,
      id: 3,
      keep: false,
    });
    expect(parseChoice({ type: DOWNLOAD_CHOICE, id: 3, keep: "no" })).toBeNull();
  });

  it("words the two reasons", () => {
    expect(askText({ reason: "installer", fileSite: "x.example", fileType: "exe" })).toMatch(
      /^Warden paused a download of a \.exe file from x\.example\./,
    );
    expect(askText({ reason: "no-click", fileSite: "x.example", fileType: "" })).toContain(
      "a file",
    );
  });
});
