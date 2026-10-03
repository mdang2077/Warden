/**
 * Safe Browsing URL canonicalization, so the extension, the feed service, and the eval
 * harness turn the same URL into the same lookup key. Follows the algorithm in the
 * Safe Browsing API docs ("URLs and Hashing"):
 *
 *  1. Remove tab, CR, and LF characters; trim leading/trailing spaces; drop the fragment.
 *  2. Split into scheme, host, path, and query (default scheme: http; port and userinfo dropped).
 *  3. Percent-unescape each component repeatedly until it stops changing.
 *  4. Host: lowercase, strip leading/trailing dots, collapse runs of dots, normalize IPv4
 *     in any legal encoding (octal, hex, decimal, fewer than four parts).
 *  5. Path: resolve `.` and `..`, collapse runs of slashes. Empty path becomes `/`.
 *  6. Re-escape bytes <= 0x20, >= 0x7F, `#`, and `%` as uppercase %XX.
 *
 * Internally everything is a "byte string" (each char is one byte, 0-255), which is what
 * the spec's test vectors assume. `canonicalize` UTF-8 encodes its input first.
 */

export interface CanonicalUrl {
  /** Full canonical URL, e.g. `http://www.google.com/a/b?c`. */
  url: string;
  scheme: string;
  /** Canonical, escaped host. */
  host: string;
  /** Canonical, escaped path. Always starts with `/`. */
  path: string;
  /** Canonical, escaped query without the `?`, or null when the URL has no `?`. */
  query: string | null;
}

/** Canonicalize a URL given as a normal JS string. Returns null if it has no usable host. */
export function canonicalize(url: string): CanonicalUrl | null {
  return canonicalizeBytes(toByteString(url));
}

/** Canonicalize a URL given as a byte string (each char code is one byte, 0-255). */
export function canonicalizeBytes(input: string): CanonicalUrl | null {
  let s = input.replace(/[\t\r\n]/g, "").replace(/^ +| +$/g, "");
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash);

  let scheme = "http";
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(s);
  if (schemeMatch?.[1]) {
    scheme = schemeMatch[1].toLowerCase();
    s = s.slice(schemeMatch[0].length);
  }

  const authorityEnd = s.search(/[/?]/);
  const authority = authorityEnd === -1 ? s : s.slice(0, authorityEnd);
  const rest = authorityEnd === -1 ? "" : s.slice(authorityEnd);

  const host = canonicalHost(stripPort(stripUserinfo(authority)));
  if (host === null) return null;

  const q = rest.indexOf("?");
  const rawPath = q === -1 ? rest : rest.slice(0, q);
  const rawQuery = q === -1 ? null : rest.slice(q + 1);

  const path = sbEscape(normalizePath(unescapeFully(rawPath)));
  const query = rawQuery === null ? null : sbEscape(unescapeFully(rawQuery));

  const url = `${scheme}://${host}${path}${query === null ? "" : `?${query}`}`;
  return { url, scheme, host, path, query };
}

function stripUserinfo(authority: string): string {
  const at = authority.lastIndexOf("@");
  return at === -1 ? authority : authority.slice(at + 1);
}

function stripPort(hostPort: string): string {
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    return close === -1 ? hostPort : hostPort.slice(0, close + 1);
  }
  return hostPort.replace(/:\d*$/, "");
}

function canonicalHost(raw: string): string | null {
  let host = unescapeFully(raw).toLowerCase();
  if (!host.startsWith("[")) {
    host = host.replace(/^\.+|\.+$/g, "").replace(/\.{2,}/g, ".");
    host = parseIPv4(host) ?? host;
  }
  if (host === "") return null;
  return sbEscape(host);
}

/**
 * inet_aton-style IPv4 parsing: 1-4 dot-separated parts, each decimal, octal (leading 0),
 * or hex (0x). The last part fills all remaining bytes. Returns dotted decimal or null.
 */
export function parseIPv4(host: string): string | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    let value: number;
    if (/^0x[0-9a-f]*$/i.test(part)) value = part.length === 2 ? 0 : Number.parseInt(part, 16);
    else if (/^0[0-7]*$/.test(part)) value = Number.parseInt(part, 8);
    else if (/^[1-9][0-9]*$/.test(part)) value = Number.parseInt(part, 10);
    else return null;
    if (!Number.isSafeInteger(value)) return null;
    values.push(value);
  }

  const last = values.pop() as number;
  if (values.some((v) => v > 0xff)) return null;
  const lastBytes = 4 - values.length;
  if (last >= 2 ** (8 * lastBytes)) return null;

  const bytes = [...values];
  for (let i = lastBytes - 1; i >= 0; i--) bytes.push(Math.floor(last / 2 ** (8 * i)) % 256);
  return bytes.join(".");
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  const parts = path.split("/");
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const last = parts[parts.length - 1];
  const trailingSlash = path.endsWith("/") || last === "." || last === "..";
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}${trailingSlash ? "/" : ""}`;
}

/** Percent-unescape repeatedly until the string stops changing. */
export function unescapeFully(s: string): string {
  let prev: string;
  let cur = s;
  do {
    prev = cur;
    cur = prev.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  } while (cur !== prev);
  return cur;
}

/** Escape bytes <= 0x20, >= 0x7F, `#`, and `%`. */
function sbEscape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x20 || c >= 0x7f || c === 0x23 || c === 0x25) {
      out += `%${c.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += s[i];
    }
  }
  return out;
}

/** UTF-8 encode into a byte string (one char per byte). */
function toByteString(s: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(s)) out += String.fromCharCode(byte);
  return out;
}
