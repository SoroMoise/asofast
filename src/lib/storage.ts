/**
 * Stockage local des fichiers uploades et generes.
 * Remplace les buckets Supabase Storage par le dossier ./data/uploads/.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function resolveSafe(relPath: string): string {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\$))+/, "");
  const absolute = path.resolve(UPLOADS_DIR, normalized);
  const relativeToRoot = path.relative(UPLOADS_DIR, absolute);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Invalid storage path: ${relPath}`);
  }
  return absolute;
}

export function saveFile(relPath: string, buffer: Buffer): string {
  const absolute = resolveSafe(relPath);
  ensureDir(path.dirname(absolute));
  writeFileSync(absolute, buffer);
  return relPath;
}

export function readFile(relPath: string): Buffer {
  const absolute = resolveSafe(relPath);
  return readFileSync(absolute);
}

export function deleteFile(relPath: string): void {
  const absolute = resolveSafe(relPath);
  rmSync(absolute, { force: true });
}

export type StorageEntry = {
  name: string;
  path: string;
};

export function listFiles(prefix = ""): StorageEntry[] {
  const absolute = resolveSafe(prefix || ".");
  ensureDir(absolute);
  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => ({
      name: e.name,
      path: path.join(prefix, e.name).replace(/\\/g, "/"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getUploadsDir(): string {
  return UPLOADS_DIR;
}
