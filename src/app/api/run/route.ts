import { isPipelineRunning, runPipeline } from "@/lib/pipeline";
import { listRunSummaries } from "@/lib/runArchive";
import { simulateRun } from "@/lib/simulator";

// Temporary switch: when set, the "Run Pipeline" button replays the most
// recent archived run instead of calling any real API -- same button, same
// polling, zero API cost. Flip SIMULATE_RUN_PIPELINE off in .env.local (or
// delete the var) to go back to a real run.
const SIMULATE_ONLY = process.env.SIMULATE_RUN_PIPELINE === "true";

// GET lets the "Run Pipeline" button poll whether a run is already in
// flight (e.g. after a page refresh) so it can show the right state.
export async function GET() {
  return Response.json({ running: isPipelineRunning(), simulateOnly: SIMULATE_ONLY });
}

// POST kicks the pipeline off and returns immediately (fire-and-forget) --
// progress is already visible live via /api/status, /api/workers, and
// /api/jev-activity, which the dashboard polls independently.
export async function POST() {
  if (isPipelineRunning()) {
    return Response.json({ error: "Pipeline is already running" }, { status: 409 });
  }

  if (SIMULATE_ONLY) {
    const [latest] = listRunSummaries(); // sorted most-recent-first
    if (!latest) {
      return Response.json(
        { error: "SIMULATE_RUN_PIPELINE is on but there's no archived run to replay yet" },
        { status: 409 }
      );
    }
    simulateRun(latest.runId).catch((err) => {
      console.error("Simulated run failed:", err);
    });
    return Response.json({ started: true, simulated: true, sourceRunId: latest.runId });
  }

  runPipeline().catch((err) => {
    console.error("Pipeline run failed:", err);
  });

  return Response.json({ started: true });
}
