import type { KeyValueArea } from "./overrides.ts";

/** In-memory stand-in for a chrome.storage area. */
export function memoryArea(): KeyValueArea & { remove(key: string): Promise<void> } {
  const data: Record<string, unknown> = {};
  return {
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(key) {
      delete data[key];
    },
  };
}
