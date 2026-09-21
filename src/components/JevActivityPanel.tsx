"use client";

import { useEffect, useState } from "react";
import type { JevCallStatus, JevLogEntry } from "@/lib/jevLog";
import AnalysisMethodologyModal from "./AnalysisMethodologyModal";
import WorkerPoolPanel from "./WorkerPoolPanel";

// Same polling cadence as ResumeTable.tsx / JevNowEvaluating.tsx.
const POLL_INTERVAL_MS = 1500;

const STATUS_BADGE_CLASS: Record<JevCallStatus, string> = {
  running: "bg-status-progress/15 text-status-progress",
  completed: "bg-status-success/15 text-status-success",
  error: "bg-status-failed/15 text-status-failed",
};

const STATUS_LABEL: Record<JevCallStatus, string> = {
  running: "Running",
  completed: "Completed",
  error: "Error",
};

function StatusBadge({ status }: { status: JevCallStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[status]}`}
    >
      {status === "running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-progress" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

// Honest lifecycle framing: the backend only ever reports running / completed
// / error for a single HTTP call (no separate "sent" vs "waiting" signal), so
// "running" is expressed as the in-flight phrase below rather than inventing
// fake intermediate stages.
function LifecycleLine({ status }: { status: JevCallStatus }) {
  if (status === "running") {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-status-progress">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-progress" />
        Request sent, waiting for response...
      </p>
    );
  }
  if (status === "completed") {
    return (
      <p className="text-xs font-medium text-status-success">
        Response received &middot; completed
      </p>
    );
  }
  return (
    <p className="text-xs font-medium text-status-failed">
      Response received &middot; failed
    </p>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-xs text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function JevActivityPanel() {
  const [entries, setEntries] = useState<JevLogEntry[]>([]);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  // Collapsed by default -- the input/output JSON is dense, so entries only
  // expand when the user explicitly clicks one.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/jev-activity", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { entries: JevLogEntry[] } = await res.json();
        if (!cancelled) setEntries(data.entries);
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

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-foreground">Jev Activity</h2>
      <button
        type="button"
        onClick={() => setMethodologyOpen(true)}
        className="rounded-full border border-border bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-bright hover:brightness-110"
      >
        What is Jev evaluating?
      </button>
      <AnalysisMethodologyModal
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
      />
    </div>
  );

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
        <div className="shrink-0">{header}</div>
        <div className="shrink-0">
          <WorkerPoolPanel />
        </div>
        <div className="shrink-0">
          <h2 className="text-sm font-semibold text-foreground">
            Job Activity Log
          </h2>
          <div className="mt-2 rounded-lg border border-border bg-surface p-8 text-center text-sm text-foreground-muted">
            No Jev activity yet.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <div className="shrink-0">{header}</div>
      <div className="shrink-0">
        <WorkerPoolPanel />
      </div>
      <h2 className="shrink-0 text-sm font-semibold text-foreground">
        Job Activity Log
      </h2>
      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {entries.map((entry) => {
          const expanded = expandedIds.has(entry.id);
          return (
            <div
              key={entry.id}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <button
                type="button"
                onClick={() => toggleExpanded(entry.id)}
                className="flex w-full flex-col gap-2 text-left"
                aria-expanded={expanded}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {entry.resumeId}
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {entry.label}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={entry.status} />
                    <span
                      className={`text-foreground-muted transition-transform ${expanded ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      &rsaquo;
                    </span>
                  </div>
                </div>

                <p className="text-xs text-foreground-muted">
                  Started {new Date(entry.startedAt).toLocaleTimeString()}
                  {entry.completedAt &&
                    ` · Completed ${new Date(entry.completedAt).toLocaleTimeString()}`}
                </p>

                <LifecycleLine status={entry.status} />
              </button>

              {expanded && (
                <div className="mt-3 flex flex-col gap-3">
                  <JsonBlock label="Input: state" value={entry.input.state} />
                  <JsonBlock
                    label="Input: questions"
                    value={entry.input.questions}
                  />
                  {entry.error !== undefined ? (
                    <JsonBlock label="Error" value={entry.error} />
                  ) : (
                    <JsonBlock label="Output" value={entry.output ?? null} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
