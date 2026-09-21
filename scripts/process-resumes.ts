// CLI entry point for the pipeline. The actual logic lives in
// src/lib/pipeline.ts so it can also be triggered from the dashboard's "Run
// Pipeline" button (src/app/api/run/route.ts) inside the Next.js process.
//
// Run: npx tsx scripts/process-resumes.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import { runPipeline } from "../src/lib/pipeline";

runPipeline()
  .then(({ processed }) => {
    console.log(`Processed ${processed} resumes.`);
  })
  .catch((err) => {
    console.error("process-resumes failed:", err);
    process.exit(1);
  });
