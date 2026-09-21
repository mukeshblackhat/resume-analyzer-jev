"use client";

import { useEffect, useState } from "react";
import type { JevLogEntry } from "@/lib/jevLog";

// Same polling cadence as ResumeTable.tsx: fast enough to feel live, slow
// enough not to hammer the file-backed log endpoint.
const POLL_INTERVAL_MS = 1500;

export default function JevNowEvaluating() {
  const [entries, setEntries] = useState<JevLogEntry[]>([]);

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

  const running = entries.filter((entry) => entry.status === "running");

  if (running.length === 0) return null;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-accent-bright">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-accent" />
        </span>
        Jev is currently evaluating...
      </div>
      <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-foreground-muted">
        {running.map((entry) => (
          <li key={entry.id}>
            <span className="text-foreground">{entry.resumeId}</span>
            {" -> "}
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
