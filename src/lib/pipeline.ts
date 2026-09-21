// Core pipeline runner: extract -> score every resume in data/resumes/,
// updating data/status.json after every stage transition (including
// per-stage timing) so the dashboard reflects live progress, and writing one
// data/results/<id>.json per completed resume for the detail view.
//
// Extracted out of scripts/process-resumes.ts so it can be called both from
// the CLI script and from the "Run Pipeline" button's API route
// (src/app/api/run/route.ts), which runs it in-process inside the Next.js
// dev server rather than spawning a separate script.
//
// Runs up to CONCURRENCY resumes at once. Safe with the current
// statusStore.ts/workerStatus.ts: every update call is fully synchronous (no
// `await` between its read and write), so Node's single-threaded event loop
// can never interleave two updates -- true even with several extract/score
// calls in flight concurrently.

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractResume } from "./extractor";
import { archiveRun } from "./runArchive";
import { beginRun, endRun } from "./runContext";
import { scoreResume } from "./scoring";
import { initStatus, readStatus, updateStatus } from "./statusStore";
import { initWorkers, setWorkerBusy, setWorkerIdle } from "./workerStatus";
import type { JobDescription, ResumeResult, StageTimings } from "./types";

export { isPipelineRunning } from "./runContext";

export const CONCURRENCY = 5;
const RESUMES_DIR = path.join(process.cwd(), "data", "resumes");
const RESULTS_DIR = path.join(process.cwd(), "data", "results");
const JD_PATH = path.join(process.cwd(), "data", "job-description.json");

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once.
 * Each of the `concurrency` slots keeps a stable `workerId` (0..concurrency-1)
 * for the whole run, picking up the next item as soon as it finishes one --
 * that stable id is what lets the dashboard show "worker 2 is now on
 * resume-07" rather than a fresh id per item.
 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, workerId: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function runSlot(workerId: number): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], workerId);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, (_, workerId) => runSlot(workerId))
  );
}

async function processResume(fileName: string, jd: JobDescription, workerId: number): Promise<void> {
  const id = path.basename(fileName, path.extname(fileName));
  const filePath = path.join(RESUMES_DIR, fileName);
  const startedAt = Date.now();
  let extractionMs: number | undefined;
  let scoringMs: number | undefined;

  try {
    // Extraction is now a purely local, synchronous-cost step (no external
    // call) -- the worker pool only tracks Jev calls, per the intended
    // design, so no setWorkerBusy here.
    updateStatus(id, { stage: "extracting" });
    const extractStart = Date.now();
    const extracted = await extractResume(filePath);
    extractionMs = Date.now() - extractStart;

    updateStatus(id, { stage: "scoring", timings: { extractionMs } });
    setWorkerBusy(workerId, id, "scoring");
    const scoreStart = Date.now();
    const breakdown = await scoreResume(extracted, jd);
    scoringMs = Date.now() - scoreStart;

    const timings: StageTimings = { extractionMs, scoringMs, totalMs: Date.now() - startedAt };
    const result: ResumeResult = { extracted, breakdown, timings };
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(path.join(RESULTS_DIR, `${id}.json`), JSON.stringify(result, null, 2));

    updateStatus(id, {
      stage: "completed",
      compositeScore: breakdown.compositeScore,
      eligible: breakdown.eligible,
      timings,
    });
    console.log(`  [done]   ${id} -> composite ${breakdown.compositeScore} (${timings.totalMs}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timings: StageTimings = { extractionMs, scoringMs, totalMs: Date.now() - startedAt };
    updateStatus(id, { stage: "failed", error: message, timings });
    console.log(`  [failed] ${id} -> ${message} (${timings.totalMs}ms)`);
  } finally {
    setWorkerIdle(workerId);
  }
}

export interface PipelineRunSummary {
  processed: number;
  runId: string;
}

export async function runPipeline(): Promise<PipelineRunSummary> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  beginRun(runId); // throws if a run or simulation is already in progress
  try {
    const jd: JobDescription = JSON.parse(readFileSync(JD_PATH, "utf-8"));
    const fileNames = readdirSync(RESUMES_DIR)
      .filter((f) => f.endsWith(".pdf"))
      .sort();

    if (fileNames.length === 0) {
      throw new Error(`No PDFs found in ${RESUMES_DIR}. Run generate-dummy-resumes.ts first.`);
    }

    initStatus(fileNames);
    initWorkers(Math.min(CONCURRENCY, fileNames.length));
    console.log(
      `Processing ${fileNames.length} resumes against "${jd.title}" (concurrency ${CONCURRENCY}, run ${runId})...\n`
    );

    await runPool(fileNames, CONCURRENCY, (fileName, workerId) => processResume(fileName, jd, workerId));

    console.log("\nDone. See data/status.json and data/results/*.json");
    return { processed: fileNames.length, runId };
  } finally {
    // Archive even on a thrown error (e.g. no PDFs found) so partial runs
    // aren't silently lost -- readStatus() may legitimately not exist yet if
    // we failed before initStatus(), so tolerate that.
    try {
      const jd: JobDescription = JSON.parse(readFileSync(JD_PATH, "utf-8"));
      const status = readStatus();
      archiveRun({ runId, startedAt, jobDescription: jd, entries: status.entries });
    } catch {
      // Nothing to archive (failed before any status existed) -- fine.
    }
    endRun();
  }
}
