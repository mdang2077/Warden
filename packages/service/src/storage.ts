/**
 * Blob storage the pipeline writes to. R2 in the Worker, the filesystem in the Node CLI,
 * and memory in tests. Keys are `/`-separated paths like `v1/manifest.json`.
 */
export interface BlobStore {
  get(key: string): Promise<string | null>;
  put(key: string, body: string, contentType?: string): Promise<void>;
  /** Keys under `prefix`, unordered. */
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export async function getJson<T>(store: BlobStore, key: string): Promise<T | null> {
  const text = await store.get(key);
  return text === null ? null : (JSON.parse(text) as T);
}

export async function putJson(store: BlobStore, key: string, value: unknown): Promise<string> {
  const body = JSON.stringify(value);
  await store.put(key, body, "application/json");
  return body;
}

export function memoryStore(): BlobStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, body) {
      data.set(key, body);
    },
    async list(prefix) {
      return [...data.keys()].filter((k) => k.startsWith(prefix));
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

/** A view of `store` with every key under `prefix` (the dev run's separate area). */
export function prefixedStore(store: BlobStore, prefix: string): BlobStore {
  return {
    get: (key) => store.get(prefix + key),
    put: (key, body, contentType) => store.put(prefix + key, body, contentType),
    list: async (p) => (await store.list(prefix + p)).map((k) => k.slice(prefix.length)),
    delete: (key) => store.delete(prefix + key),
  };
}
