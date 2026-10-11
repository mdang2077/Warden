import { describe, expect, it } from "vitest";
import { decodeSearchHashesResponse, encodeSearchHashesResponse } from "./sb-protobuf.ts";

/**
 * A real reply from safebrowsing.googleapis.com/v5/hashes:search for Google's test phishing
 * page (prefix 771MOg==), captured 2026-10-11: one full hash, SOCIAL_ENGINEERING, 300 s.
 */
const REAL = Uint8Array.from(
  Buffer.from(
    "0a260a20efbd4c3ab44f327eb13ca942ad7c7f0ab47ec260a4d0b8051684a01b2ef3522012020802120308ac02",
    "hex",
  ),
);
const TEST_PAGE_HASH = Buffer.from(
  "efbd4c3ab44f327eb13ca942ad7c7f0ab47ec260a4d0b8051684a01b2ef35220",
  "hex",
).toString("base64");

describe("decodeSearchHashesResponse", () => {
  it("decodes Google's real answer for the test phishing page", () => {
    expect(decodeSearchHashesResponse(REAL)).toEqual({
      fullHashes: [
        {
          fullHash: TEST_PAGE_HASH,
          fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING", attributes: [] }],
        },
      ],
      cacheDuration: "300s",
    });
  });

  it("decodes an empty answer", () => {
    expect(decodeSearchHashesResponse(new Uint8Array())).toEqual({ fullHashes: [] });
  });

  it("round-trips attributes, and reads unpacked ones", () => {
    const r = {
      fullHashes: [
        {
          fullHash: TEST_PAGE_HASH,
          fullHashDetails: [
            { threatType: "SOCIAL_ENGINEERING", attributes: ["CANARY", "FRAME_ONLY"] },
            { threatType: "MALWARE", attributes: [] },
          ],
        },
      ],
      cacheDuration: "60s",
    };
    expect(decodeSearchHashesResponse(encodeSearchHashesResponse(r))).toEqual(r);
    // FullHashDetail { threat_type: 2, attributes: 1 (unpacked) }
    const detail = [0x08, 0x02, 0x10, 0x01];
    const fh = [0x12, detail.length, ...detail];
    const msg = Uint8Array.from([0x0a, fh.length, ...fh]);
    expect(decodeSearchHashesResponse(msg).fullHashes[0]?.fullHashDetails).toEqual([
      { threatType: "SOCIAL_ENGINEERING", attributes: ["CANARY"] },
    ]);
  });

  it("skips unknown fields and names unknown enum values", () => {
    // field 7 varint, field 9 fixed64, then a full hash whose detail has threat type 9
    const detail = [0x08, 0x09];
    const fh = [0x12, detail.length, ...detail];
    const msg = Uint8Array.from([0x38, 0x05, 0x49, 1, 2, 3, 4, 5, 6, 7, 8, 0x0a, fh.length, ...fh]);
    expect(decodeSearchHashesResponse(msg).fullHashes[0]?.fullHashDetails[0]?.threatType).toBe(
      "UNKNOWN_9",
    );
  });

  it("throws on truncated input", () => {
    expect(() => decodeSearchHashesResponse(REAL.subarray(0, 10))).toThrow();
    expect(() => decodeSearchHashesResponse(Uint8Array.from([0x0a]))).toThrow();
  });
});
