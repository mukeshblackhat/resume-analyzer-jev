// Direct client for TypeSafe's Jev API -- bypasses the Vercel AI Gateway
// entirely for scoring (the Gateway account is blocked on a missing credit
// card; this uses TYPESAFE_API_KEY against api.typesafe.ai directly instead).
// Extraction (src/lib/extractor.ts) is unaffected by this file and still
// goes through the Gateway, since it needs a generative model, not Jev.
//
// Request/response shapes below are taken verbatim from docs.typesafe.ai
// (api.md, primitives/score.md, primitives/noul.md), not guessed:
//   POST /v1/systemone
//   { state, model: "jev-latest", questions: { id: { type, instructions, criteria } } }
// -> { model, answers: { id: {...} }, usage }
// "score" answers report `score` as a position in [0, levels.length - 1]
// (not pre-normalized) plus `confidence`/`probabilities`/`legend`.
// "noul" answers report a single `noul` field, P(true) in [0, 1].

import { logJevCallEnd, logJevCallStart } from "./jevLog";

const TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL_ID = "jev-latest";

export interface ScoreQuestion {
  instructions: string;
  levels: string[];
}

export interface BooleanQuestion {
  instructions: string;
}

interface JevScoreResult {
  /** Normalized to [0, 1] from the API's raw [0, levels.length - 1] position. */
  normalizedScore: number;
}

interface JevBooleanResult {
  /** P(true), in [0, 1]. */
  probability: number;
}

type TypeSafeAnswer =
  | { type: "score"; score: number; confidence?: number; probabilities?: Record<string, number>; legend?: Record<string, string> }
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number };

interface TypeSafeResponse {
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callJev(
  state: Record<string, unknown>,
  questions: Record<string, unknown>
): Promise<TypeSafeResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing TYPESAFE_API_KEY in .env.local");
  }

  const res = await fetch(TYPESAFE_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: JEV_MODEL_ID, questions }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TypeSafe API call failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Runs a batch of Score questions against one shared state in a single Jev
 * call (questions run in parallel server-side and cannot see each other).
 */
export async function askJevScores(
  resumeId: string,
  state: Record<string, unknown>,
  questions: Record<string, ScoreQuestion>
): Promise<Record<string, JevScoreResult>> {
  const apiQuestions = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [
      id,
      { type: "score", instructions: q.instructions, criteria: q.levels },
    ])
  );
  const logId = logJevCallStart({ resumeId, label: Object.keys(questions).join(", "), input: { state, questions: apiQuestions } });

  let response: TypeSafeResponse;
  try {
    response = await callJev(state, apiQuestions);
  } catch (err) {
    logJevCallEnd(logId, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  logJevCallEnd(logId, { output: response.answers });

  return Object.fromEntries(
    Object.entries(response.answers).map(([id, answer]) => {
      const levelCount = questions[id].levels.length;
      const normalizedScore = answer.type === "score" ? answer.score / (levelCount - 1) : 0;
      return [id, { normalizedScore }];
    })
  );
}

/** Runs a batch of boolean (Noul) questions against one shared state. */
export async function askJevBooleans(
  resumeId: string,
  state: Record<string, unknown>,
  questions: Record<string, BooleanQuestion>
): Promise<Record<string, JevBooleanResult>> {
  const apiQuestions = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [id, { type: "noul", instructions: q.instructions }])
  );
  const logId = logJevCallStart({ resumeId, label: Object.keys(questions).join(", "), input: { state, questions: apiQuestions } });

  let response: TypeSafeResponse;
  try {
    response = await callJev(state, apiQuestions);
  } catch (err) {
    logJevCallEnd(logId, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  logJevCallEnd(logId, { output: response.answers });

  return Object.fromEntries(
    Object.entries(response.answers).map(([id, answer]) => [
      id,
      { probability: answer.type === "noul" ? answer.noul : 0 },
    ])
  );
}
