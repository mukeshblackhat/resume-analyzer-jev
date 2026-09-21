import { listRunSummaries } from "@/lib/runArchive";

export async function GET() {
  return Response.json({ runs: listRunSummaries() });
}
