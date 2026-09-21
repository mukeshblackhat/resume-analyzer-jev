"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { PipelineStage, ResumeResult, StatusEntry } from "@/lib/types";
import ResumeDetail from "./ResumeDetail";

// Fast enough to feel live, slow enough not to hammer the file-backed
// status endpoint while the pipeline is running.
const POLL_INTERVAL_MS = 1500;

type SortMode = "bestFit" | "filename";

const STAGE_BADGE_CLASS: Record<PipelineStage, string> = {
  pending: "bg-status-pending/15 text-status-pending",
  extracting: "bg-status-progress/15 text-status-progress",
  scoring: "bg-status-progress/15 text-status-progress",
  completed: "bg-status-success/15 text-status-success",
  failed: "bg-status-failed/15 text-status-failed",
};

const STAGE_LABEL: Record<PipelineStage, string> = {
  pending: "Pending",
  extracting: "Extracting",
  scoring: "Scoring",
  completed: "Completed",
  failed: "Failed",
};

// Formats a stage duration for display: sub-second durations show as whole
// milliseconds ("870ms"), anything at or above 1000ms switches to seconds
// with one decimal place ("1.2s").
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// "Best fit" bucket order: eligible-and-completed first, then
// ineligible-but-completed, then still-in-progress, then failed last.
// Ineligible resumes are deliberately kept visible (just demoted) rather than
// hidden here -- a fluky high score shouldn't win the top slot, but the user
// asked for a *ranking*, and silently dropping rows from "Best fit" would
// hide information the eligibility filter already exists to hide on purpose.
function bestFitBucket(entry: StatusEntry): number {
  if (entry.stage === "completed") return entry.eligible === false ? 1 : 0;
  if (entry.stage === "failed") return 3;
  return 2; // pending / extracting / scoring
}

// Sorts by "Best fit": bucket first, then compositeScore descending within
// the two completed buckets. Buckets 2 and 3 keep their relative (natural)
// order since there's no score to rank in-progress/failed rows by.
function compareBestFit(a: StatusEntry, b: StatusEntry): number {
  const bucketDiff = bestFitBucket(a) - bestFitBucket(b);
  if (bucketDiff !== 0) return bucketDiff;
  if (a.stage === "completed" && b.stage === "completed") {
    return (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
  }
  return 0;
}

// The score filter only applies to completed resumes -- pending/extracting/
// scoring/failed rows have no compositeScore yet, so hiding them just
// because they're below a threshold they were never scored against would be
// misleading rather than helpful.
function passesScoreFilter(entry: StatusEntry, minScore: number): boolean {
  if (entry.stage !== "completed") return true;
  return (entry.compositeScore ?? 0) >= minScore;
}

// Same reasoning as passesScoreFilter: only completed resumes can be
// ineligible, so non-completed rows always pass through.
function passesEligibilityFilter(entry: StatusEntry, eligibleOnly: boolean): boolean {
  if (!eligibleOnly) return true;
  if (entry.stage !== "completed") return true;
  return entry.eligible !== false;
}

function StageBadge({ stage }: { stage: PipelineStage }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_BADGE_CLASS[stage]}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

interface ResumeTableProps {
  initialEntries: StatusEntry[];
}

export default function ResumeTable({ initialEntries }: ResumeTableProps) {
  const [entries, setEntries] = useState<StatusEntry[]>(initialEntries);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailResult, setDetailResult] = useState<ResumeResult | null>(null);
  // "Best fit" is the default: it's the actual best-fit-by-score ranking the
  // toolbar exists for. Sorting is stable, so before anything completes this
  // is indistinguishable from filename order anyway.
  const [sortMode, setSortMode] = useState<SortMode>("bestFit");
  const [minScore, setMinScore] = useState(0);
  const [eligibleOnly, setEligibleOnly] = useState(false);

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

  // Recomputed on every render from whatever the latest poll returned --
  // filtering/sorting never touches `entries` itself, so polling keeps
  // working exactly as before.
  const visibleEntries = useMemo(() => {
    const filtered = entries.filter(
      (entry) =>
        passesScoreFilter(entry, minScore) &&
        passesEligibilityFilter(entry, eligibleOnly)
    );
    if (sortMode === "bestFit") {
      return [...filtered].sort(compareBestFit);
    }
    return filtered;
  }, [entries, sortMode, minScore, eligibleOnly]);

  async function toggleRow(entry: StatusEntry) {
    if (expandedId === entry.id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(entry.id);
    setDetailResult(null);

    if (entry.stage !== "completed") return;

    setDetailLoading(true);
    try {
      const res = await fetch(`/api/resumes/${entry.id}`);
      setDetailResult(res.ok ? await res.json() : null);
    } finally {
      setDetailLoading(false);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-foreground-muted">
        No resumes in the pipeline yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          Sort
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="bestFit">Best fit (score)</option>
            <option value="filename">Filename</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          Min score
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(event) =>
              setMinScore(
                Math.min(100, Math.max(0, Number(event.target.value) || 0))
              )
            }
            className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
          <input
            type="range"
            min={0}
            max={100}
            value={minScore}
            onChange={(event) => setMinScore(Number(event.target.value))}
            className="accent-accent"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            checked={eligibleOnly}
            onChange={(event) => setEligibleOnly(event.target.checked)}
            className="accent-accent"
          />
          Eligible only
        </label>

        <span className="ml-auto text-xs text-foreground-muted">
          Showing {visibleEntries.length} of {entries.length}
        </span>
      </div>

      {visibleEntries.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-foreground-muted">
          No resumes match the current filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-border text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-2 font-medium">Resume</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Updated</th>
                <th className="px-4 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr
                    onClick={() => toggleRow(entry)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-raised"
                  >
                    <td className="px-4 py-2.5 text-foreground">
                      {entry.fileName}
                    </td>
                    <td className="px-4 py-2.5">
                      <StageBadge stage={entry.stage} />
                      {entry.stage === "failed" && entry.error && (
                        <span className="ml-2 text-xs text-status-failed">
                          {entry.error}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {entry.compositeScore ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted">
                      {new Date(entry.updatedAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted">
                      {entry.timings?.totalMs !== undefined
                        ? formatDuration(entry.timings.totalMs)
                        : "—"}
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr className="border-b border-border last:border-0">
                      <td colSpan={5} className="bg-background/40 px-4 py-3">
                        <ResumeDetail
                          loading={detailLoading}
                          result={detailResult}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
