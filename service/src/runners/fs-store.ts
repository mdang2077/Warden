import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlobStore } from "../storage.ts";

/** Filesystem store for the Node CLI (local runs, or GitHub Actions publishing a directory). */
export function fsStore(root: string): BlobStore {
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`bad key ${key}`);
    return full;
  };
  return {
    async get(key) {
      try {
        return await readFile(resolve(key), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async put(key, body) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
    },
    async list(prefix) {
      const files = await readdir(path.resolve(root), { recursive: true }).catch(() => []);
      return files.map((f) => f.split(path.sep).join("/")).filter((k) => k.startsWith(prefix));
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
