import { readJevLog } from "@/lib/jevLog";
import type { JevLogEntry } from "@/lib/jevLog";

export async function GET() {
  // readJevLog() already returns [] when data/jev-log.json doesn't exist yet,
  // so no pipeline-not-started special case is needed here.
  const entries: JevLogEntry[] = readJevLog().sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  return Response.json({ entries });
}
