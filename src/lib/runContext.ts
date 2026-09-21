// Shared "is anything running" guard and active-run-id tracker, used by both
// a real pipeline run (pipeline.ts) and a replayed simulation
// (simulator.ts) -- only one of either may run at a time in this process.
// jevLog.ts reads the current run id to tag call entries without every call
// site threading a runId parameter through.

let running = false;
let currentRunId: string | undefined;

export function isPipelineRunning(): boolean {
  return running;
}

/** Claims the run slot for `runId`. Throws if a run (real or simulated) is already in progress. */
export function beginRun(runId: string): void {
  if (running) {
    throw new Error("A pipeline run (or simulation) is already in progress");
  }
  running = true;
  currentRunId = runId;
}

export function endRun(): void {
  running = false;
  currentRunId = undefined;
}

export function getCurrentRunId(): string | undefined {
  return currentRunId;
}
