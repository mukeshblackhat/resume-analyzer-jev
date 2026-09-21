# Setup

## Prerequisites

- Node.js 20+
- A TypeSafe API key (from `console.typesafe.ai`) for Jev scoring.
  `src/lib/jevClient.ts` calls `api.typesafe.ai` directly with this key.

No other external service is required. PDF extraction (`src/lib/extractor.ts`)
is fully local -- it reads text out of the PDF with `pdf-parse` and structures
it with plain-text heuristics, no external API call. (One known tradeoff:
resumes written as unstructured prose with no section headers can't be
reliably parsed by heuristics alone -- see the comment at the top of
`extractor.ts`.)

## Configure environment variables

1. Copy the example file:
   ```sh
   cp .env.local.example .env.local
   ```
2. Open `.env.local` and set `TYPESAFE_API_KEY`.
   **Never commit `.env.local` or paste the key's value into any doc, commit,
   or chat.** It's already covered by `.env*` in `.gitignore`.

## Install dependencies

```sh
npm install
```

## Run the pipeline

1. Generate the dummy resume dataset:
   ```sh
   npx tsx scripts/generate-dummy-resumes.ts
   ```
2. Run the extraction + scoring pipeline (or use the "Run Pipeline" button in
   the dashboard, which does the same thing via `POST /api/run`):
   ```sh
   npx tsx scripts/process-resumes.ts
   ```
3. In a separate terminal, start the dashboard:
   ```sh
   npm run dev
   ```
   Open the printed URL (port 3000, or the next free port if that's taken) to
   watch resumes move through `pending -> extracting -> scoring ->
   completed/failed` live, with per-stage timing and the full Jev call log.
