/**
 * Safe Browsing v5 `hashes.search` replies in binary protobuf only (with an API key, `alt=json`
 * is refused as "Unsupported Output Format"). This decodes a `SearchHashesResponse` into the
 * JSON shape of the v5 REST docs, which is what the extension reads:
 *
 *   SearchHashesResponse { repeated FullHash full_hashes = 1; Duration cache_duration = 2; }
 *   FullHash { bytes full_hash = 1; repeated FullHashDetail full_hash_details = 2; }
 *   FullHashDetail { ThreatType threat_type = 1; repeated ThreatAttribute attributes = 2; }
 *   Duration { int64 seconds = 1; int32 nanos = 2; }
 *
 * Unknown fields are skipped, so additions on Google's side don't break it.
 */

export interface SbFullHash {
  /** Base64 of the 32-byte hash. */
  fullHash: string;
  fullHashDetails: { threatType: string; attributes: string[] }[];
}

export interface SbSearchResponse {
  fullHashes: SbFullHash[];
  /** Like "300s"; absent when Google sent none. */
  cacheDuration?: string;
}

const THREAT_TYPES = [
  "THREAT_TYPE_UNSPECIFIED",
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION",
];
const ATTRIBUTES = ["THREAT_ATTRIBUTE_UNSPECIFIED", "CANARY", "FRAME_ONLY"];
const enumName = (names: readonly string[], n: number) => names[n] ?? `UNKNOWN_${n}`;

type Field =
  | { field: number; wire: 0; value: number }
  | { field: number; wire: 2; bytes: Uint8Array };

/** Splits one message into its fields; skips fixed-width ones. Throws on malformed input. */
function* fields(buf: Uint8Array): Generator<Field> {
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      if (pos >= buf.length) throw new Error("protobuf: truncated varint");
      const b = buf[pos++] as number;
      result += (b & 0x7f) * scale;
      if (b < 0x80) return result;
      scale *= 128;
    }
    throw new Error("protobuf: varint too long");
  };
  while (pos < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) yield { field, wire, value: varint() };
    else if (wire === 2) {
      const len = varint();
      if (pos + len > buf.length) throw new Error("protobuf: truncated field");
      yield { field, wire, bytes: buf.subarray(pos, pos + len) };
      pos += len;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new Error(`protobuf: unsupported wire type ${wire}`);
    if (pos > buf.length) throw new Error("protobuf: truncated field");
  }
}

/** A repeated enum, packed (one length-delimited field) or not (one varint per value). */
function enumValues(f: Field): number[] {
  if (f.wire === 0) return [f.value];
  const out: number[] = [];
  let pos = 0;
  const b = f.bytes;
  while (pos < b.length) {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (pos >= b.length) throw new Error("protobuf: truncated packed enum");
      const x = b[pos++] as number;
      v += (x & 0x7f) * scale;
      if (x < 0x80) break;
      scale *= 128;
    }
    out.push(v);
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function decodeDetail(buf: Uint8Array): SbFullHash["fullHashDetails"][number] {
  let threatType = 0;
  const attributes: string[] = [];
  for (const f of fields(buf)) {
    if (f.field === 1 && f.wire === 0) threatType = f.value;
    else if (f.field === 2) for (const v of enumValues(f)) attributes.push(enumName(ATTRIBUTES, v));
  }
  return { threatType: enumName(THREAT_TYPES, threatType), attributes };
}

function decodeFullHash(buf: Uint8Array): SbFullHash {
  let fullHash = "";
  const fullHashDetails: SbFullHash["fullHashDetails"] = [];
  for (const f of fields(buf)) {
    if (f.wire !== 2) continue;
    if (f.field === 1) fullHash = base64(f.bytes);
    else if (f.field === 2) fullHashDetails.push(decodeDetail(f.bytes));
  }
  return { fullHash, fullHashDetails };
}

function decodeDuration(buf: Uint8Array): string {
  let seconds = 0;
  let nanos = 0;
  for (const f of fields(buf)) {
    if (f.wire !== 0) continue;
    if (f.field === 1) seconds = f.value;
    else if (f.field === 2) nanos = f.value;
  }
  return `${seconds + nanos / 1e9}s`;
}

export function decodeSearchHashesResponse(buf: Uint8Array): SbSearchResponse {
  const out: SbSearchResponse = { fullHashes: [] };
  for (const f of fields(buf)) {
    if (f.wire !== 2) continue;
    if (f.field === 1) out.fullHashes.push(decodeFullHash(f.bytes));
    else if (f.field === 2) out.cacheDuration = decodeDuration(f.bytes);
  }
  return out;
}

/** The inverse, for tests and fixtures: same message, packed attributes. */
export function encodeSearchHashesResponse(r: SbSearchResponse): Uint8Array {
  const out: number[] = [];
  const varint = (target: number[], n: number) => {
    let v = n;
    while (v >= 0x80) {
      target.push((v % 128) | 0x80);
      v = Math.floor(v / 128);
    }
    target.push(v);
  };
  const lenField = (target: number[], field: number, bytes: number[]) => {
    varint(target, field * 8 + 2);
    varint(target, bytes.length);
    target.push(...bytes);
  };
  for (const h of r.fullHashes) {
    const fh: number[] = [];
    lenField(
      fh,
      1,
      [...atob(h.fullHash)].map((c) => c.charCodeAt(0)),
    );
    for (const d of h.fullHashDetails) {
      const det: number[] = [];
      varint(det, 1 * 8);
      varint(det, Math.max(0, THREAT_TYPES.indexOf(d.threatType)));
      const packed: number[] = [];
      for (const a of d.attributes ?? []) varint(packed, Math.max(0, ATTRIBUTES.indexOf(a)));
      if (packed.length) lenField(det, 2, packed);
      lenField(fh, 2, det);
    }
    lenField(out, 1, fh);
  }
  const m = r.cacheDuration ? /^(\d+)s$/.exec(r.cacheDuration) : null;
  if (m?.[1]) {
    const dur: number[] = [];
    varint(dur, 1 * 8);
    varint(dur, Number(m[1]));
    lenField(out, 2, dur);
  }
  return new Uint8Array(out);
}
