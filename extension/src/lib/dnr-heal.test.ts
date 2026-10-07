import type { Decision } from "@warden/shared/types";
import { describe, expect, it, vi } from "vitest";
import { createDnrHealer } from "./dnr-heal.ts";

function setup(decision: Decision) {
  const deps = {
    evaluate: vi.fn(async () => decision),
    allow: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  };
  return { deps, heal: createDnrHealer(deps) };
}

const blocked = (url = "https://trusted.example/") => ({
  tabId: 3,
  frameId: 0,
  url,
  error: "net::ERR_BLOCKED_BY_CLIENT",
});

describe("DNR healer", () => {
  it("allows and reloads a URL the cascade doesn't block", async () => {
    const { deps, heal } = setup("allow");
    expect(await heal(blocked())).toBe("healed");
    expect(deps.allow).toHaveBeenCalledWith("https://trusted.example/");
    expect(deps.reload).toHaveBeenCalledWith(3, "https://trusted.example/");
  });

  it("leaves real blocks to the interstitial", async () => {
    const { deps, heal } = setup("block");
    expect(await heal(blocked())).toBe("skipped");
    expect(deps.allow).not.toHaveBeenCalled();
  });

  it("hands pop-network blocks to the hijack action and never heals them", async () => {
    const onHijack = vi.fn(async () => {});
    const deps = {
      evaluate: vi.fn(async () => "allow" as const),
      allow: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      isHijack: (url: string) => url.includes("popads.net"),
      onHijack,
    };
    const heal = createDnrHealer(deps);
    const event = blocked("https://go.popads.net/x");
    expect(await heal(event)).toBe("hijack");
    expect(await heal(event)).toBe("hijack"); // every time, not just once
    expect(onHijack).toHaveBeenCalledTimes(2);
    expect(onHijack).toHaveBeenCalledWith(event);
    expect(deps.evaluate).not.toHaveBeenCalled();
    expect(deps.allow).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("retries a URL only once, so it can't loop against another blocker", async () => {
    const { deps, heal } = setup("allow");
    await heal(blocked("https://ads.example/x#a"));
    expect(await heal(blocked("https://ads.example/x#b"))).toBe("skipped");
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("ignores other errors, subframes, and URLs Warden never evaluates", async () => {
    const { deps, heal } = setup("allow");
    await heal({ ...blocked(), error: "net::ERR_NAME_NOT_RESOLVED" });
    await heal({ ...blocked(), frameId: 2 });
    await heal(blocked("http://192.168.1.1/"));
    expect(deps.evaluate).not.toHaveBeenCalled();
  });
});
