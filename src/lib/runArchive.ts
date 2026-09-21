// Permanent, per-run snapshots in data/runs/<runId>.json -- unlike
// data/status.json (which reflects only the *current* run's live state and
// gets reset each time), these are never overwritten. This is what a replay
// (src/lib/simulator.ts) reads to re-drive the dashboard without calling any
// real API.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readJevLogForRun, type JevLogEntry } from "./jevLog";
import type { JobDescription, ResumeResult, StatusEntry } from "./types";

const RUNS_DIR = path.join(process.cwd(), "data", "runs");
const RESULTS_DIR = path.join(process.cwd(), "data", "results");

export interface RunArchive {
  runId: string;
  startedAt: string;
  completedAt: string;
  jobDescription: JobDescription;
  entries: StatusEntry[];
  jevLog: JevLogEntry[];
  /** Full result (extracted fields + score breakdown) for every resume that completed, keyed by resume id. */
  results: Record<string, ResumeResult>;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  completedAt: string;
  total: number;
  completed: number;
  failed: number;
}

function readResultIfPresent(id: string): ResumeResult | undefined {
  const filePath = path.join(RESULTS_DIR, `${id}.json`);
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf-8")) as ResumeResult;
}

/** Snapshots the given run's final state (status entries, its Jev calls, and every completed resume's result) permanently. */
export function archiveRun(params: {
  runId: string;
  startedAt: string;
  jobDescription: JobDescription;
  entries: StatusEntry[];
}): void {
  const results: Record<string, ResumeResult> = {};
  for (const entry of params.entries) {
    if (entry.stage !== "completed") continue;
    const result = readResultIfPresent(entry.id);
    if (result) results[entry.id] = result;
  }

  const archive: RunArchive = {
    runId: params.runId,
    startedAt: params.startedAt,
    completedAt: new Date().toISOString(),
    jobDescription: params.jobDescription,
    entries: params.entries,
    jevLog: readJevLogForRun(params.runId),
    results,
  };

  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(path.join(RUNS_DIR, `${params.runId}.json`), JSON.stringify(archive, null, 2));
}

export function listRunSummaries(): RunSummary[] {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const archive: RunArchive = JSON.parse(readFileSync(path.join(RUNS_DIR, f), "utf-8"));
      return {
        runId: archive.runId,
        startedAt: archive.startedAt,
        completedAt: archive.completedAt,
        total: archive.entries.length,
        completed: archive.entries.filter((e) => e.stage === "completed").length,
        failed: archive.entries.filter((e) => e.stage === "failed").length,
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function readRunArchive(runId: string): RunArchive {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`No archived run with id "${runId}"`);
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as RunArchive;
}
