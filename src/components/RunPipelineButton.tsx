"use client";

import { useEffect, useState } from "react";

// Same polling cadence as ResumeTable.tsx / JevNowEvaluating.tsx / WorkerPoolPanel.tsx.
const POLL_INTERVAL_MS = 1500;

export default function RunPipelineButton() {
  const [running, setRunning] = useState(false);
  // Optimistic flag set immediately on click so the button feels responsive
  // even before the next /api/run poll confirms the real state. The poll is
  // still the source of truth (e.g. after a 409 race, or a refresh mid-run).
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/run", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { running: boolean } = await res.json();
        if (cancelled) return;
        setRunning(data.running);
        if (data.running) setStarting(false);
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

  async function handleClick() {
    setStarting(true);
    try {
      const res = await fetch("/api/run", { method: "POST" });
      if (res.status === 409) {
        // Another caller beat us to it -- not an error, the poll will
        // pick up the real running state shortly.
        return;
      }
      if (res.ok) setRunning(true);
    } catch {
      // transient fetch failure — the poll will reconcile state either way
      setStarting(false);
    }
  }

  const isRunning = running || starting;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isRunning}
      className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-4 py-2 text-sm font-medium text-accent-bright transition-colors disabled:cursor-not-allowed disabled:opacity-80"
    >
      {isRunning && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-accent" />
        </span>
      )}
      {isRunning ? "Running..." : "Run Pipeline"}
    </button>
  );
}
