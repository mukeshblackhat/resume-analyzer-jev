import { getScoringMethodology } from "@/lib/scoring";

export async function GET() {
  return Response.json(getScoringMethodology());
}
