// Replays a previously-archived run (src/lib/runArchive.ts) back into the
// live status/worker/jev-log files -- no extraction, no real Jev call, zero
// API cost -- so the dashboard can be demoed or UI-tested "running" without
// spending real API credits. Every replayed Jev-call entry is tagged
// `simulated: true` so it's never mistaken for a real call in the activity
// log or in a future archive.
//
// Paced by the ORIGINAL run's recorded per-stage timings (StageTimings),
// scaled down by `speed`, so it animates the same relative rhythm the real
// run had (a resume that took 3x longer to score still takes visibly longer
// here) rather than every resume flashing to "completed" instantly.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logJevCallEnd, logJevCallStart } from "./jevLog";
import { readRunArchive, type RunArchive } from "./runArchive";
import { beginRun, endRun } from "./runContext";
import { initStatus, updateStatus } from "./statusStore";
import type { StatusEntry } from "./types";
import { initWorkers, setWorkerBusy, setWorkerIdle } from "./workerStatus";

const RESULTS_DIR = path.join(process.cwd(), "data", "results");
const CONCURRENCY = 5; // mirrors pipeline.ts's real concurrency for a faithful-looking replay

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function replayOne(entry: StatusEntry, workerId: number, archive: RunArchive, speed: number): Promise<void> {
  const id = entry.id;
  const call = archive.jevLog.find((c) => c.resumeId === id);

  try {
    updateStatus(id, { stage: "extracting" });
    await sleep((entry.timings?.extractionMs ?? 50) / speed);

    // No Jev call in the original run means it failed during extraction --
    // replay that outcome as-is, nothing to score.
    if (!call) {
      updateStatus(id, { stage: "failed", error: entry.error ?? "extraction failed (replayed)", timings: entry.timings });
      return;
    }

    updateStatus(id, { stage: "scoring", timings: { extractionMs: entry.timings?.extractionMs } });
    setWorkerBusy(workerId, id, "scoring");

    const logId = logJevCallStart({
      resumeId: id,
      label: call.label,
      input: call.input,
      simulated: true,
    });
    await sleep((entry.timings?.scoringMs ?? 800) / speed);
    logJevCallEnd(logId, { output: call.output, error: call.error });

    const result = archive.results[id];
    if (entry.stage === "completed" && result) {
      mkdirSync(RESULTS_DIR, { recursive: true });
      writeFileSync(path.join(RESULTS_DIR, `${id}.json`), JSON.stringify(result, null, 2));
      updateStatus(id, {
        stage: "completed",
        compositeScore: entry.compositeScore,
        eligible: entry.eligible,
        timings: entry.timings,
      });
    } else {
      updateStatus(id, { stage: "failed", error: entry.error, timings: entry.timings });
    }
  } finally {
    setWorkerIdle(workerId);
  }
}

export interface SimulationSummary {
  processed: number;
  sourceRunId: string;
}

/** `speed` divides every recorded delay -- 4 (default) replays ~4x faster than the original run actually took. */
export async function simulateRun(sourceRunId: string, speed = 4): Promise<SimulationSummary> {
  const archive = readRunArchive(sourceRunId);
  const replayId = randomUUID();
  beginRun(replayId); // throws if a real run or another simulation is already in progress
  try {
    const fileNames = archive.entries.map((e) => e.fileName);
    initStatus(fileNames);
    initWorkers(Math.min(CONCURRENCY, fileNames.length));

    let cursor = 0;
    async function runSlot(workerId: number): Promise<void> {
      while (true) {
        const index = cursor++;
        if (index >= archive.entries.length) return;
        await replayOne(archive.entries[index], workerId, archive, speed);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, fileNames.length) }, (_, workerId) => runSlot(workerId))
    );

    return { processed: fileNames.length, sourceRunId };
  } finally {
    endRun();
  }
}
