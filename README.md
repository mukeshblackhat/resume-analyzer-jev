# Resume Analyzer

Scores resumes against a job description using [Jev](https://docs.typesafe.ai)
(TypeSafe's structured-judgment model) for the scoring step, with a live
dashboard showing extraction/scoring progress, a worker pool view, and a full
Jev call log with input/output.

- **Extraction** is fully local (`src/lib/extractor.ts`): `pdf-parse` pulls
  text, plain-text heuristics structure it into fields. No external API call.
- **Scoring** (`src/lib/scoring.ts`, `src/lib/jevClient.ts`) combines
  deterministic JD rule checks (years of experience, required-skill coverage,
  education level) with Jev-scored soft dimensions (skill depth, domain
  relevance, seniority fit), calling TypeSafe's API directly.
- **Dashboard** (`src/app/page.tsx` and `src/components/`) polls the pipeline's
  live state and lets you sort/filter for best-fit candidates.
- **Replay simulator** (`src/lib/simulator.ts`) can replay a past run's
  recorded data back into the dashboard with zero real API calls -- see
  `SIMULATE_RUN_PIPELINE` in `docs/SETUP.md`.

See **[docs/SETUP.md](docs/SETUP.md)** for environment setup and how to run
the pipeline. See **[TODO.md](TODO.md)** for the build history.

## Important: local-only architecture

The pipeline (`Run Pipeline` button, live status, worker pool, Jev activity
log) works by reading and writing local JSON files on disk
(`data/status.json`, `data/jev-log.json`, etc.), synchronously, in a single
long-running Node process. **This does not work correctly on Vercel's
serverless functions**, which don't share persistent local disk across
requests or invocations -- a request that starts a run and a later request
polling its status can land on different, stateless instances. Run this with
`npm run dev` / `npm start` on a persistent host (or your own machine) for the
pipeline features to work as intended. A Vercel deployment would need the
pipeline state moved to a real database or blob store to behave the same way.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in TYPESAFE_API_KEY
npx tsx scripts/generate-dummy-resumes.ts
npm run dev
```

Full details in [docs/SETUP.md](docs/SETUP.md).
