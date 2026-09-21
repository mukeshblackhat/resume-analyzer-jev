import { readStatus } from "@/lib/statusStore";
import type { StatusFile } from "@/lib/types";
import SummaryStats from "@/components/SummaryStats";
import ResumeTable from "@/components/ResumeTable";
import JevNowEvaluating from "@/components/JevNowEvaluating";
import JevActivityPanel from "@/components/JevActivityPanel";
import RunPipelineButton from "@/components/RunPipelineButton";

// Read directly from disk for the initial render instead of fetching our
// own API route, avoiding a same-server request waterfall on first load.
function readInitialStatus(): StatusFile {
  try {
    return readStatus();
  } catch {
    return { startedAt: new Date().toISOString(), entries: [] };
  }
}

export default async function Home() {
  const status = readInitialStatus();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-10 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Resume Analyzer
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Live status of resumes moving through extraction and Jev-powered
            scoring against the job description.
          </p>
        </div>
        <RunPipelineButton />
      </header>

      <div className="shrink-0">
        <JevNowEvaluating />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
          <div className="shrink-0">
            <SummaryStats initialEntries={status.entries} />
          </div>
          <ResumeTable initialEntries={status.entries} />
        </div>
        <JevActivityPanel />
      </div>
    </div>
  );
}
