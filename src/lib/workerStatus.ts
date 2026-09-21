// Tracks each concurrent worker slot in the pipeline runner's pool, so the
// dashboard can show "N workers running in parallel, here's what each one is
// doing right now" live. Same sync-fs, single-process reasoning as
// statusStore.ts/jevLog.ts: no `await` between read and write, so concurrent
// callers can't interleave.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORKER_STATUS_PATH = path.join(process.cwd(), "data", "worker-status.json");

export type WorkerStage = "idle" | "extracting" | "scoring";

export interface WorkerSlot {
  workerId: number;
  stage: WorkerStage;
  resumeId?: string; // undefined while idle
  updatedAt: string;
}

function readSlots(): WorkerSlot[] {
  if (!existsSync(WORKER_STATUS_PATH)) return [];
  return JSON.parse(readFileSync(WORKER_STATUS_PATH, "utf-8")) as WorkerSlot[];
}

function writeSlots(slots: WorkerSlot[]): void {
  mkdirSync(path.dirname(WORKER_STATUS_PATH), { recursive: true });
  writeFileSync(WORKER_STATUS_PATH, JSON.stringify(slots, null, 2));
}

/** Creates `count` idle worker slots, persists them, and returns them. */
export function initWorkers(count: number): WorkerSlot[] {
  const now = new Date().toISOString();
  const slots: WorkerSlot[] = Array.from({ length: count }, (_, workerId) => ({
    workerId,
    stage: "idle",
    updatedAt: now,
  }));
  writeSlots(slots);
  return slots;
}

function updateWorker(workerId: number, patch: Partial<WorkerSlot>): void {
  const slots = readSlots();
  const slot = slots.find((s) => s.workerId === workerId);
  if (!slot) return; // worker pool not initialized (e.g. running scoring outside the pipeline runner) -- no-op
  Object.assign(slot, patch, { updatedAt: new Date().toISOString() });
  writeSlots(slots);
}

export function setWorkerBusy(workerId: number, resumeId: string, stage: Exclude<WorkerStage, "idle">): void {
  updateWorker(workerId, { resumeId, stage });
}

export function setWorkerIdle(workerId: number): void {
  updateWorker(workerId, { resumeId: undefined, stage: "idle" });
}

export function readWorkers(): WorkerSlot[] {
  return readSlots();
}
