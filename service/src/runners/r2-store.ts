import type { BlobStore } from "../storage.ts";

export function r2Store(bucket: R2Bucket): BlobStore {
  return {
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? obj.text() : null;
    },
    async put(key, body, contentType = "application/octet-stream") {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    async list(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
