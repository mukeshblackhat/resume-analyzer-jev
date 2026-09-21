// Records every Jev call (what was sent, what came back) to data/jev-log.json
// so the dashboard can show "what Jev is evaluating" live and a full,
// permanent input/output history across every pipeline run -- every call
// gets its own unique log entry (never overwritten by a later call for the
// same resume), so re-running the pipeline accumulates history instead of
// erasing the previous run's activity. Same sync-fs, single-process
// reasoning as statusStore.ts: no `await` between read and write, so
// concurrent callers can't interleave.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCurrentRunId } from "./runContext";

const LOG_PATH = path.join(process.cwd(), "data", "jev-log.json");

export type JevCallStatus = "running" | "completed" | "error";

export interface JevLogEntry {
  id: string; // unique per call (crypto.randomUUID()) -- never reused, so history is never overwritten
  runId?: string; // which pipeline run produced this call, for archiving/replay
  simulated?: boolean; // true if this entry was replayed from a past run, not a real Jev call
  resumeId: string;
  label: string; // short human-readable description, e.g. "skill_depth, domain_relevance, seniority_fit"
  status: JevCallStatus;
  startedAt: string;
  completedAt?: string;
  input: {
    state: unknown;
    questions: unknown;
  };
  output?: unknown;
  error?: string;
}

function readLog(): JevLogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  return JSON.parse(readFileSync(LOG_PATH, "utf-8")) as JevLogEntry[];
}

function writeLog(entries: JevLogEntry[]): void {
  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2));
}

/** Starts a new, permanent log entry and returns its unique id (pass it to logJevCallEnd). Tags with the active run id, if any. */
export function logJevCallStart(entry: {
  resumeId: string;
  label: string;
  input: JevLogEntry["input"];
  simulated?: boolean;
  /** Override the auto-detected current run id -- used by the replay simulator, which sets its own runId per replayed call. */
  runId?: string;
  /** Override the auto timestamp -- used by the replay simulator to preserve original relative timing. */
  startedAt?: string;
}): string {
  const id = randomUUID();
  const entries = readLog();
  entries.push({
    id,
    resumeId: entry.resumeId,
    label: entry.label,
    input: entry.input,
    simulated: entry.simulated,
    runId: entry.runId ?? getCurrentRunId(),
    status: "running",
    startedAt: entry.startedAt ?? new Date().toISOString(),
  });
  writeLog(entries);
  return id;
}

export function logJevCallEnd(
  id: string,
  patch: { output?: unknown; error?: string; completedAt?: string }
): void {
  const entries = readLog();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  Object.assign(entry, patch, {
    status: patch.error ? "error" : "completed",
    completedAt: patch.completedAt ?? new Date().toISOString(),
  });
  writeLog(entries);
}

export function readJevLog(): JevLogEntry[] {
  return readLog();
}

export function readJevLogForRun(runId: string): JevLogEntry[] {
  return readLog().filter((e) => e.runId === runId);
}
