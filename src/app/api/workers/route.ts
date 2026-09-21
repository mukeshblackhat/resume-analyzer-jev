import { readWorkers } from "@/lib/workerStatus";

export async function GET() {
  return Response.json({ workers: readWorkers() });
}
