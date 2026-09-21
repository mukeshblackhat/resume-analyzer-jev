import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) ships a worker file it resolves at runtime;
  // bundling it through Next's server compiler breaks that resolution
  // (pdf.worker.mjs "cannot find module"). Excluding it from the bundle and
  // requiring it natively avoids the issue entirely -- per pdf-parse's own
  // Next.js/serverless guidance.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
