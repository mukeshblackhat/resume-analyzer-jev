import type { ResumeResult } from "@/lib/types";

interface ResumeDetailProps {
  loading: boolean;
  result: ResumeResult | null;
}

// Formats a stage duration for display: sub-second durations show as whole
// milliseconds ("870ms"), anything at or above 1000ms switches to seconds
// with one decimal place ("1.2s"). Mirrors ResumeTable.tsx's formatDuration.
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ResumeDetail({ loading, result }: ResumeDetailProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-4 text-sm text-foreground-muted">
        Loading resume detail…
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-4 text-sm text-foreground-muted">
        Not yet scored — results will appear here once the pipeline finishes
        this resume.
      </div>
    );
  }

  const { extracted, breakdown, timings } = result;

  const timingRows: Array<{ label: string; ms: number }> = [
    ...(timings?.extractionMs !== undefined
      ? [{ label: "Extraction", ms: timings.extractionMs }]
      : []),
    ...(timings?.scoringMs !== undefined
      ? [{ label: "Scoring", ms: timings.scoringMs }]
      : []),
    ...(timings?.totalMs !== undefined
      ? [{ label: "Total", ms: timings.totalMs }]
      : []),
  ];

  return (
    <div className="grid gap-4 rounded-lg border border-border bg-surface-raised p-4 md:grid-cols-2">
      <section>
        <h3 className="text-sm font-semibold text-foreground">
          {extracted.name}
        </h3>
        <p className="mt-0.5 text-xs text-foreground-muted">
          {extracted.yearsExperience} years experience
        </p>

        <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Skills
        </h4>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {extracted.skills.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-bright"
            >
              {skill}
            </span>
          ))}
        </div>

        <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Education
        </h4>
        <ul className="mt-1 space-y-0.5 text-sm text-foreground">
          {extracted.education.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>

        <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Experience
        </h4>
        <ul className="mt-1 space-y-2">
          {extracted.experience.map((entry, index) => (
            <li key={`${entry.company}-${index}`} className="text-sm">
              <p className="text-foreground">
                {entry.title} · {entry.company}{" "}
                <span className="text-foreground-muted">
                  ({entry.years}y)
                </span>
              </p>
              <p className="text-xs text-foreground-muted">
                {entry.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Score breakdown
          </h4>
          <span className="text-lg font-semibold text-accent-bright">
            {breakdown.compositeScore}/100
          </span>
        </div>
        <p className="mt-0.5 text-xs text-foreground-muted">
          {breakdown.eligible ? "Eligible" : "Not eligible (failed a rule check)"}
        </p>

        <h5 className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Rule checks
        </h5>
        <ul className="mt-1 space-y-1">
          {breakdown.ruleChecks.map((check) => (
            <li key={check.key} className="flex items-start gap-2 text-sm">
              <span
                className={
                  check.passed ? "text-status-success" : "text-status-failed"
                }
              >
                {check.passed ? "✓" : "✗"}
              </span>
              <span>
                <span className="text-foreground">{check.label}</span>
                <span className="block text-xs text-foreground-muted">
                  {check.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <h5 className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Dimensions
        </h5>
        <ul className="mt-1 space-y-1.5">
          {breakdown.dimensions.map((dimension) => (
            <li key={dimension.key} className="text-sm">
              <div className="flex items-center justify-between">
                <span className="text-foreground">{dimension.label}</span>
                <span className="text-foreground-muted">
                  {Math.round(dimension.rawScore * 100)}%{" "}
                  <span className="text-xs">
                    (weight {Math.round(dimension.weight * 100)}%)
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(dimension.rawScore * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>

        {timingRows.length > 0 && (
          <>
            <h5 className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Timings
            </h5>
            <ul className="mt-1 space-y-0.5">
              {timingRows.map((row) => (
                <li
                  key={row.label}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-foreground">{row.label}</span>
                  <span className="text-foreground-muted">
                    {formatDuration(row.ms)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
