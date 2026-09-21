import { readStatus } from "@/lib/statusStore";
import type { StatusFile } from "@/lib/types";

export async function GET() {
  let status: StatusFile;
  try {
    status = readStatus();
  } catch {
    // No pipeline run yet — render an idle empty state instead of erroring.
    status = { startedAt: new Date().toISOString(), entries: [] };
  }
  return Response.json(status);
}
