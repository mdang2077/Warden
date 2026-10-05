import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EgressProxy, startEgressProxy } from "./egress-proxy.ts";

/** A local "internet": answers every HTTP request with its Host header. */
let upstream: http.Server;
let upstreamPort: number;
let proxy: EgressProxy;
const dialed: string[] = [];
const refused: string[] = [];
let rebindCalls = 0;

beforeAll(async () => {
  upstream = http.createServer((req, res) => res.end(`hello ${req.headers.host}`));
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;
  proxy = await startEgressProxy({
    resolveHost: async (host) => {
      if (host === "public.example") return ["93.184.216.34"];
      if (host === "intranet.example") return ["10.0.0.5"];
      // Rebinding: public on the first lookup, private afterwards.
      if (host === "rebind.example") return rebindCalls++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"];
      throw new Error("NXDOMAIN");
    },
    dial: (address) => {
      dialed.push(address);
      return net.connect(upstreamPort, "127.0.0.1");
    },
    onRefused: (host, reason) => refused.push(`${host}:${reason}`),
  });
});

afterAll(async () => {
  await proxy.close();
  await new Promise((r) => upstream.close(r));
});

function viaProxy(url: string): Promise<{ status: number; body: string }> {
  const { port } = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: url, headers: { host: new URL(url).host } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function connectVia(target: string): Promise<string> {
  const { port } = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(port), "127.0.0.1", () =>
      s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
    );
    s.once("data", (d) => {
      resolve(d.toString().split("\r\n")[0] ?? "");
      s.destroy();
    });
    s.on("error", reject);
  });
}

describe("egress proxy", () => {
  it("forwards plain HTTP to public hosts", async () => {
    expect(await viaProxy("http://public.example/x")).toEqual({
      status: 200,
      body: "hello public.example",
    });
  });

  it("refuses plain HTTP to private, loopback, and unresolvable hosts", async () => {
    for (const url of [
      "http://intranet.example/",
      "http://127.0.0.1:8080/",
      "http://localhost/",
      "http://gone.example/",
    ]) {
      expect((await viaProxy(url)).status, url).toBe(403);
    }
    expect(refused).toEqual(
      expect.arrayContaining(["intranet.example:private", "gone.example:unresolved"]),
    );
  });

  it("tunnels CONNECT to public hosts and refuses private ones", async () => {
    expect(await connectVia("public.example:443")).toBe("HTTP/1.1 200 Connection Established");
    expect(await connectVia("intranet.example:443")).toBe("HTTP/1.1 403 Forbidden");
    expect(await connectVia("[::1]:443")).toBe("HTTP/1.1 403 Forbidden");
    expect(await connectVia("192.168.1.1:80")).toBe("HTTP/1.1 403 Forbidden");
  });

  it("connects to the address it checked, so rebinding can't swap in a private one", async () => {
    dialed.length = 0;
    rebindCalls = 0;
    expect((await viaProxy("http://rebind.example/")).status).toBe(200);
    expect(dialed).toEqual(["93.184.216.34"]);
    // The next lookup returns 127.0.0.1, and the proxy refuses it.
    expect((await viaProxy("http://rebind.example/")).status).toBe(403);
  });

  it("never dials when it refuses", async () => {
    const before = dialed.length;
    await viaProxy("http://intranet.example/");
    expect(dialed.length).toBe(before);
  });
});
