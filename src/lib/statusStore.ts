// Read/write data/status.json, the pipeline's single source of truth for
// per-resume progress. Consumed by the dashboard UI (polling) and written
// by the pipeline runner as each resume moves through stages.
//
// Synchronous fs is intentional: this is a local, single-process CLI script
// (scripts/process-resumes.ts) updating one small file frequently -- there's
// no concurrent writer to race against, so sync read-modify-write keeps the
// logic simple and avoids interleaved-write bugs that async would invite.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StatusEntry, StatusFile } from "./types";

const STATUS_FILE_PATH = path.join(process.cwd(), "data", "status.json");

function writeStatusFile(status: StatusFile): void {
  mkdirSync(path.dirname(STATUS_FILE_PATH), { recursive: true });
  writeFileSync(STATUS_FILE_PATH, JSON.stringify(status, null, 2));
}

/** Creates a fresh status file with every resume marked "pending", persists it, and returns it. */
export function initStatus(fileNames: string[]): StatusFile {
  const now = new Date().toISOString();
  const status: StatusFile = {
    startedAt: now,
    entries: fileNames.map((fileName) => ({
      id: path.basename(fileName, path.extname(fileName)),
      fileName,
      stage: "pending",
      updatedAt: now,
    })),
  };
  writeStatusFile(status);
  return status;
}

/** Reads the current status file. Throws if it hasn't been created yet (call initStatus first). */
export function readStatus(): StatusFile {
  if (!existsSync(STATUS_FILE_PATH)) {
    throw new Error(
      `statusStore: no status file at "${STATUS_FILE_PATH}" -- call initStatus() first`
    );
  }
  return JSON.parse(readFileSync(STATUS_FILE_PATH, "utf-8")) as StatusFile;
}

/** Merges `patch` into the entry with the given `id` and bumps its `updatedAt`, then persists the file. */
export function updateStatus(id: string, patch: Partial<StatusEntry>): void {
  const status = readStatus();
  const entry = status.entries.find((e) => e.id === id);
  if (!entry) {
    throw new Error(`statusStore: no status entry with id "${id}"`);
  }
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  writeStatusFile(status);
}
