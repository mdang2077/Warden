import { describe, expect, it } from "vitest";
import { isAuthPopupHost } from "./auth-popups.ts";

describe("auth popup hosts", () => {
  it("matches listed sign-in and payment hosts exactly", () => {
    expect(isAuthPopupHost("accounts.google.com")).toBe(true);
    expect(isAuthPopupHost("ACCOUNTS.GOOGLE.COM.")).toBe(true);
    expect(isAuthPopupHost("checkout.stripe.com")).toBe(true);
  });

  it("does not match lookalikes or other subdomains", () => {
    expect(isAuthPopupHost("accounts.google.com.evil.example")).toBe(false);
    expect(isAuthPopupHost("evil.github.com")).toBe(false);
    expect(isAuthPopupHost("google.com")).toBe(false);
  });
});
