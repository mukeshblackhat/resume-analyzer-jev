import { isPipelineRunning } from "@/lib/pipeline";
import { simulateRun } from "@/lib/simulator";

// Fire-and-forget, mirrors /api/run: POST { runId } replays an archived run
// (data/runs/<runId>.json) into the live dashboard state with zero real API
// calls, at a `speed`x-compressed version of its original timing.
export async function POST(request: Request) {
  if (isPipelineRunning()) {
    return Response.json({ error: "Pipeline is already running" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const { runId, speed } = body as { runId?: string; speed?: number };
  if (!runId) {
    return Response.json({ error: "Missing runId" }, { status: 400 });
  }

  simulateRun(runId, speed).catch((err) => {
    console.error("Simulation run failed:", err);
  });

  return Response.json({ started: true });
}
