import { describe, expect, it } from "vitest";
import { registrableDomain } from "../psl.ts";
import { exfilSignal, idpDomains } from "./exfil-signal.ts";

const scan = (over: Partial<Parameters<typeof exfilSignal>[0]> = {}) => ({
  endpoint: null,
  ip: false,
  formHosts: [],
  ...over,
});

describe("exfilSignal", () => {
  it("reports an exfil endpoint found in page code", () => {
    expect(exfilSignal(scan({ endpoint: "telegram" }), "login.evil.example")).toEqual({
      kind: "telegram",
      ip: false,
    });
  });

  it("flags a login form posting to another site", () => {
    expect(
      exfilSignal(scan({ formHosts: ["collect.other.example"] }), "secure-login.evil.example"),
    ).toEqual({ kind: "crossSiteForm", ip: false });
  });

  it("does not flag same-site posts or known sign-in providers", () => {
    expect(exfilSignal(scan({ formHosts: ["auth.shop.example"] }), "www.shop.example")).toBeNull();
    expect(
      exfilSignal(scan({ formHosts: ["login.microsoftonline.com"] }), "portal.company.example"),
    ).toBeNull();
    expect(exfilSignal(scan({ formHosts: ["acme.okta.com"] }), "intranet.acme.example")).toBeNull();
  });

  it("treats a hosting-platform tenant as its own site", () => {
    expect(exfilSignal(scan({ formHosts: ["b.github.io"] }), "a.github.io")).toEqual({
      kind: "crossSiteForm",
      ip: false,
    });
  });

  it("keeps an IP lookup as a supporting flag, and nothing otherwise", () => {
    expect(exfilSignal(scan({ ip: true }), "x.example")).toEqual({ kind: null, ip: true });
    expect(exfilSignal(scan(), "x.example")).toBeNull();
  });

  it("ships a sign-in provider list of registrable domains", () => {
    expect(idpDomains.length).toBeGreaterThan(5);
    for (const d of idpDomains) expect(registrableDomain(d), d).toBe(d);
  });
});
