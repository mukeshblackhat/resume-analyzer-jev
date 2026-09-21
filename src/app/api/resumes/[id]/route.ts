import fs from "node:fs/promises";
import path from "node:path";
import type { ResumeResult } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resultPath = path.join(process.cwd(), "data", "results", `${id}.json`);

  try {
    const raw = await fs.readFile(resultPath, "utf-8");
    const result = JSON.parse(raw) as ResumeResult;
    return Response.json(result);
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
