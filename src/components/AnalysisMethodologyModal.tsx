"use client";

import { useEffect, useState } from "react";
import type { ScoringMethodology } from "@/lib/scoring";

interface AnalysisMethodologyModalProps {
  open: boolean;
  onClose: () => void;
}

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ScoringMethodology };

/**
 * Modal explaining exactly what the app checks deterministically (rule
 * checks) and exactly what it asks Jev to judge (dimensions, with the real
 * weight/instructions/rating levels), sourced live from GET /api/methodology
 * so it can never drift out of sync with what actually runs.
 */
export default function AnalysisMethodologyModal({
  open,
  onClose,
}: AnalysisMethodologyModalProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  // Fetch once on mount and cache the result -- the payload is small and
  // static per server run, so there's no need to refetch on every open.
  // (This component stays mounted -- just hidden -- while `open` is false.)
  useEffect(() => {
    let cancelled = false;

    fetch("/api/methodology", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        return res.json() as Promise<ScoringMethodology>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="methodology-modal-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <h2
              id="methodology-modal-title"
              className="text-sm font-semibold text-foreground"
            >
              What Jev evaluates
            </h2>
            <p className="mt-0.5 text-xs text-foreground-muted">
              The deterministic rule checks and the Jev-scored dimensions
              used to score every resume against the job description.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-foreground-muted hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {state.status === "loading" && (
            <p className="text-sm text-foreground-muted">
              Loading methodology…
            </p>
          )}

          {state.status === "error" && (
            <p className="text-sm text-status-failed">{state.message}</p>
          )}

          {state.status === "ready" && (
            <div className="flex flex-col gap-6">
              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  Rule checks (pass/fail, gate eligibility)
                </h3>
                <ul className="mt-2 space-y-2">
                  {state.data.ruleChecks.map((check) => (
                    <li
                      key={check.key}
                      className="rounded-md border border-border bg-surface-raised p-3"
                    >
                      <p className="text-sm text-foreground">{check.label}</p>
                      <p className="mt-0.5 text-xs text-foreground-muted">
                        {check.description}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  Dimensions Jev scores
                </h3>
                <ul className="mt-2 flex flex-col gap-3">
                  {state.data.dimensions.map((dimension) => (
                    <li
                      key={dimension.key}
                      className="rounded-md border border-border bg-surface-raised p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground">
                          {dimension.label}
                        </span>
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-bright">
                          weight {Math.round(dimension.weight * 100)}%
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-foreground-muted">
                        {dimension.instructions}
                      </p>
                      <ol className="mt-2 space-y-1">
                        {dimension.levels.map((level, index) => (
                          <li
                            key={index}
                            className="flex gap-2 text-xs text-foreground"
                          >
                            <span className="shrink-0 font-mono text-accent-bright">
                              {index}
                            </span>
                            <span className="text-foreground-muted">
                              {level}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
