"use client";

import { useEffect, useState } from "react";

// Same polling cadence as JevActivityPanel.tsx / ResumeTable.tsx / JevNowEvaluating.tsx.
const POLL_INTERVAL_MS = 1500;

// Kept local rather than imported from "@/lib/workerStatus" so this client
// component doesn't pull in that module's server-only fs imports; the shape
// mirrors WorkerSlot/WorkerStage there exactly.
type WorkerStage = "idle" | "extracting" | "scoring";

interface WorkerSlot {
  workerId: number;
  stage: WorkerStage;
  resumeId?: string;
  updatedAt: string;
}

const STAGE_LABEL: Record<WorkerStage, string> = {
  idle: "Idle",
  extracting: "Extracting",
  scoring: "Scoring",
};

const STAGE_DOT_CLASS: Record<WorkerStage, string> = {
  idle: "bg-status-pending",
  extracting: "bg-status-progress",
  scoring: "bg-status-progress",
};

const STAGE_TEXT_CLASS: Record<WorkerStage, string> = {
  idle: "text-foreground-muted",
  extracting: "text-status-progress",
  scoring: "text-status-progress",
};

export default function WorkerPoolPanel() {
  const [workers, setWorkers] = useState<WorkerSlot[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/workers", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { workers: WorkerSlot[] } = await res.json();
        if (!cancelled) setWorkers(data.workers);
      } catch {
        // transient fetch failure — next tick retries
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">
        Worker Pool{workers.length > 0 && ` (${workers.length})`}
      </h2>

      {workers.length === 0 ? (
        <div className="mt-2 rounded-lg border border-border bg-surface p-4 text-center text-sm text-foreground-muted">
          No workers reported yet.
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {workers.map((worker) => (
            <div
              key={worker.workerId}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT_CLASS[worker.stage]} ${
                    worker.stage !== "idle" ? "animate-pulse" : ""
                  }`}
                />
                <span className="text-sm font-medium text-foreground">
                  Worker {worker.workerId}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-medium ${STAGE_TEXT_CLASS[worker.stage]}`}>
                  {STAGE_LABEL[worker.stage]}
                </span>
                <span className="text-foreground-muted">
                  {worker.stage === "idle" ? "Idle" : worker.resumeId}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
