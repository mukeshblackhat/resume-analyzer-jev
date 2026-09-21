// Shared contract for the resume-analyzer pipeline.
// All pipeline stages (extraction, scoring, status tracking, dashboard) read/write these shapes.

export type PipelineStage =
  | "pending"
  | "extracting"
  | "scoring"
  | "completed"
  | "failed";

/** Wall-clock duration of each pipeline stage, in milliseconds. Fields fill in as each stage completes -- a resume that fails during extraction will only ever have `totalMs`. */
export interface StageTimings {
  extractionMs?: number;
  scoringMs?: number;
  totalMs?: number;
}

export interface StatusEntry {
  id: string; // resume filename without extension, e.g. "resume-003"
  fileName: string; // e.g. "resume-003.pdf"
  stage: PipelineStage;
  updatedAt: string; // ISO timestamp of the last transition
  error?: string; // present when stage === "failed"
  compositeScore?: number; // present when stage === "completed", 0-100
  eligible?: boolean; // present when stage === "completed" -- false if any hard JD rule failed, independent of compositeScore
  timings?: StageTimings;
}

export interface StatusFile {
  startedAt: string;
  entries: StatusEntry[];
}

export interface ExtractedResume {
  id: string;
  fileName: string;
  name: string;
  yearsExperience: number;
  skills: string[];
  education: string[];
  experience: Array<{
    title: string;
    company: string;
    years: number;
    description: string;
  }>;
  rawText: string;
}

export interface JobDescription {
  title: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  minYearsExperience: number;
  minEducationLevel: "none" | "bachelors" | "masters" | "phd";
  domain: string;
}

export interface ScoreDimension {
  key: string;
  label: string;
  weight: number; // 0-1, all dimension weights sum to 1
  rawScore: number; // 0-1, from Jev (Score/Noul) before weighting
  reasoning?: string;
}

export interface RuleCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ScoreBreakdown {
  resumeId: string;
  ruleChecks: RuleCheck[]; // deterministic JD hard filters, evaluated in code
  dimensions: ScoreDimension[]; // Jev-scored soft dimensions
  compositeScore: number; // 0-100, weighted sum of dimensions (rules gate eligibility, not part of the weighted sum)
  eligible: boolean; // false if any hard rule failed
}

export interface ResumeResult {
  extracted: ExtractedResume;
  breakdown: ScoreBreakdown;
  timings: StageTimings;
}
