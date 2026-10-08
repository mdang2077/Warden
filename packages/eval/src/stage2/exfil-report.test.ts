import { describe, expect, it } from "vitest";
import { type ExfilRow, renderExfilReport } from "./exfil-report.ts";

function row(over: Partial<ExfilRow>): ExfilRow {
  return {
    group: "openphish",
    label: "phish",
    host: "login.evil.example",
    title: "Webmail",
    signal: { kind: "telegram", ip: true },
    brandMismatch: false,
    allowlisted: false,
    ...over,
  };
}

describe("exfil report", () => {
  it("counts kinds per group, both-signal pages, and lists every benign firing", () => {
    const md = renderExfilReport(
      [
        row({ group: "tranco-login", label: "benign", host: "shop.example", signal: null }),
        row({
          group: "tranco-login",
          label: "benign",
          host: "forms.example",
          title: "Contact us",
          signal: { kind: "crossSiteForm", ip: false },
          allowlisted: true,
        }),
      ],
      [
        row({ brandMismatch: true }),
        row({ signal: { kind: "discord", ip: false } }),
        row({ signal: { kind: null, ip: true } }),
        row({ signal: null }),
      ],
      ["test"],
    );
    // group | login pages | exfil | telegram | discord | form service | cross-site form | ip | brand + exfil
    expect(md).toContain("| openphish | 4 | 2 | 1 | 1 | 0 | 0 | 2 | 1 |");
    expect(md).toContain("| tranco-login | 2 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |");
    expect(md).toContain("## Benign firings (1)");
    expect(md).toContain("| tranco-login | forms.example | crossSiteForm | yes | Contact us |");
  });
});
