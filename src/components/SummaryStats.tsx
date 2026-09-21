"use client";

import { useEffect, useState } from "react";
import type { PipelineStage, StatusEntry } from "@/lib/types";

// Same polling cadence/pattern as ResumeTable.tsx and friends -- this was
// previously a plain server-rendered component with no polling at all, so it
// stayed frozen at the page's initial load instead of reflecting live runs.
const POLL_INTERVAL_MS = 1500;

interface SummaryStatsProps {
  initialEntries: StatusEntry[];
}

const STAGE_ORDER: PipelineStage[] = [
  "pending",
  "extracting",
  "scoring",
  "completed",
  "failed",
];

const STAGE_LABEL: Record<PipelineStage, string> = {
  pending: "Pending",
  extracting: "Extracting",
  scoring: "Scoring",
  completed: "Completed",
  failed: "Failed",
};

const STAGE_DOT_CLASS: Record<PipelineStage, string> = {
  pending: "bg-status-pending",
  extracting: "bg-status-progress",
  scoring: "bg-status-progress",
  completed: "bg-status-success",
  failed: "bg-status-failed",
};

export default function SummaryStats({ initialEntries }: SummaryStatsProps) {
  const [entries, setEntries] = useState<StatusEntry[]>(initialEntries);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { entries: StatusEntry[] } = await res.json();
        if (!cancelled) setEntries(data.entries);
      } catch {
        // transient fetch failure — next tick retries
      }
    }

    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const total = entries.length;
  const counts = STAGE_ORDER.reduce(
    (acc, stage) => {
      acc[stage] = entries.filter((entry) => entry.stage === stage).length;
      return acc;
    },
    {} as Record<PipelineStage, number>
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs uppercase tracking-wide text-foreground-muted">
          Total
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{total}</p>
      </div>
      {STAGE_ORDER.map((stage) => (
        <div
          key={stage}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-foreground-muted">
            <span
              className={`inline-block h-2 w-2 rounded-full ${STAGE_DOT_CLASS[stage]}`}
            />
            {STAGE_LABEL[stage]}
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {counts[stage]}
          </p>
        </div>
      ))}
    </div>
  );
}
