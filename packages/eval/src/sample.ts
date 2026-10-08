import type { FeedRecord } from "@warden/service/feeds/types";

/** Deterministic PRNG (mulberry32), so a capped sample is reproducible for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keeps at most `max` records per feed: a seeded random sample, in the original order. */
export function sampleByFeed(
  records: readonly FeedRecord[],
  max: number,
  seed: number,
): FeedRecord[] {
  const byFeed = new Map<string, number[]>();
  records.forEach((r, i) => {
    const list = byFeed.get(r.source) ?? [];
    list.push(i);
    byFeed.set(r.source, list);
  });
  const keep = new Set<number>();
  const rand = mulberry32(seed);
  for (const indexes of byFeed.values()) {
    const pool = [...indexes];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
    }
    for (const i of pool.slice(0, max)) keep.add(i);
  }
  return records.filter((_, i) => keep.has(i));
}
