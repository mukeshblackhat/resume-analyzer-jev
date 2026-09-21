// JD matching: deterministic hard-rule filters in code, soft/semantic fit
// scored by Jev. Rules gate `eligible`; only the Jev-scored dimensions feed
// the weighted `compositeScore` -- this mirrors TypeSafe's own
// composite-scoring pattern (score independent dimensions, combine with
// code-controlled weights you can retune without re-scoring).
//
// RULE_CHECK_DEFINITIONS and DIMENSION_DEFINITIONS below are the single
// source of truth for what gets checked/asked: the same arrays build the
// real per-resume rule checks and the real Jev questions, AND back
// `getScoringMethodology()`, which the dashboard's "what is Jev evaluating"
// view reads. Change a weight or wording here and both the actual scoring
// and what the UI shows the user stay in sync automatically.

import { askJevScores } from "./jevClient";
import type {
  ExtractedResume,
  JobDescription,
  RuleCheck,
  ScoreBreakdown,
  ScoreDimension,
} from "./types";

const EDUCATION_RANK: Record<JobDescription["minEducationLevel"], number> = {
  none: 0,
  bachelors: 1,
  masters: 2,
  phd: 3,
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function highestEducationRank(education: string[]): number {
  const text = normalize(education.join(" | "));
  if (/\bphd\b|doctorate/.test(text)) return EDUCATION_RANK.phd;
  if (/\bm\.?s\.?\b|master/.test(text)) return EDUCATION_RANK.masters;
  if (/\bb\.?[as]\.?\b|bachelor/.test(text)) return EDUCATION_RANK.bachelors;
  return EDUCATION_RANK.none;
}

function matchedRequiredSkills(resumeSkills: string[], requiredSkills: string[]): string[] {
  const resumeSkillSet = resumeSkills.map(normalize);
  return requiredSkills.filter((required) =>
    resumeSkillSet.some((skill) => skill.includes(normalize(required)) || normalize(required).includes(skill))
  );
}

/** Generic description of each hard rule, independent of any specific resume/JD -- feeds the methodology view. */
const RULE_CHECK_DEFINITIONS = [
  {
    key: "min_years_experience",
    label: "Minimum years of experience",
    description: "The resume's total years of experience must meet the job's minYearsExperience.",
  },
  {
    key: "required_skills_coverage",
    label: "Required skills coverage",
    description:
      "At least half of the job's requiredSkills must fuzzy-match one of the resume's listed skills.",
  },
  {
    key: "min_education_level",
    label: "Minimum education level",
    description:
      "The resume's highest detected education level (bachelors/masters/phd, inferred by keyword match against its education entries) must meet the job's minEducationLevel.",
  },
] as const;

function runRuleChecks(resume: ExtractedResume, jd: JobDescription): RuleCheck[] {
  const matched = matchedRequiredSkills(resume.skills, jd.requiredSkills);
  const requiredSkillsThreshold = Math.ceil(jd.requiredSkills.length * 0.5);
  const educationRank = highestEducationRank(resume.education);

  const byKey = (key: (typeof RULE_CHECK_DEFINITIONS)[number]["key"]) =>
    RULE_CHECK_DEFINITIONS.find((r) => r.key === key)!;

  return [
    {
      key: "min_years_experience",
      label: byKey("min_years_experience").label,
      passed: resume.yearsExperience >= jd.minYearsExperience,
      detail: `Resume shows ${resume.yearsExperience} years; requires ${jd.minYearsExperience}.`,
    },
    {
      key: "required_skills_coverage",
      label: byKey("required_skills_coverage").label,
      passed: matched.length >= requiredSkillsThreshold,
      detail: `Matched ${matched.length}/${jd.requiredSkills.length} required skills: ${
        matched.join(", ") || "none"
      }.`,
    },
    {
      key: "min_education_level",
      label: byKey("min_education_level").label,
      passed: educationRank >= EDUCATION_RANK[jd.minEducationLevel],
      detail: `Resume's highest detected education level rank is ${educationRank}; requires ${EDUCATION_RANK[jd.minEducationLevel]} (${jd.minEducationLevel}).`,
    },
  ];
}

/** Single source of truth for the three Jev-scored soft-fit dimensions: their weight, the exact instructions sent to Jev, and the ordered rating levels. */
const DIMENSION_DEFINITIONS = [
  {
    key: "skill_depth",
    label: "Skill depth",
    weight: 0.45,
    instructions:
      "Judging `resume` against `jobDescription.requiredSkills`: how much hands-on depth and " +
      "ownership does the resume's experience actually demonstrate in those required skills, " +
      "as opposed to the skills merely being listed?",
    levels: [
      "No meaningful evidence -- the required skills are absent or only tangentially mentioned.",
      "Superficial exposure -- required skills are named but with little demonstrated hands-on depth.",
      "Moderate depth -- some real hands-on ownership of required skills, but not consistent across roles.",
      "Strong depth -- clear, repeated hands-on ownership of most required skills across multiple roles.",
      "Exceptional depth -- deep, sustained ownership and technical leadership across nearly all required skills.",
    ],
  },
  {
    key: "domain_relevance",
    label: "Domain relevance",
    weight: 0.25,
    instructions:
      "How relevant is the resume's overall domain/industry background (from its experience " +
      "entries) to `jobDescription.domain`?",
    levels: [
      "Entirely unrelated domain/industry background.",
      "Adjacent domain with limited overlap in problem space.",
      "Related domain with meaningful but partial overlap.",
      "Closely related domain, strong overlap in problem space.",
      "Same domain, direct and extensive relevant background.",
    ],
  },
  {
    key: "seniority_fit",
    label: "Seniority fit",
    weight: 0.3,
    instructions:
      "`jobDescription.title` implies a certain scope of ownership and impact. Judging by the " +
      "resume's experience entries, does the seniority and scope shown match what that title expects?",
    levels: [
      "Scope and ownership shown are well below what the role expects.",
      "Somewhat below the expected scope -- limited ownership or impact shown.",
      "Roughly matches the expected scope for this level.",
      "Exceeds the expected scope in places -- clear ownership and impact.",
      "Consistently exceeds the expected scope -- broad ownership, technical leadership.",
    ],
  },
] as const;

/**
 * Builds the shared state and asks Jev to score the three soft-fit
 * dimensions in one batched call. Deliberately omits the candidate's name
 * from the state to keep the judgment scoped to demonstrated substance.
 */
async function scoreDimensionsWithJev(
  resume: ExtractedResume,
  jd: JobDescription
): Promise<ScoreDimension[]> {
  const state = {
    jobDescription: {
      title: jd.title,
      requiredSkills: jd.requiredSkills,
      niceToHaveSkills: jd.niceToHaveSkills,
      domain: jd.domain,
    },
    resume: {
      yearsExperience: resume.yearsExperience,
      skills: resume.skills,
      education: resume.education,
      experience: resume.experience,
    },
  };

  const questions = Object.fromEntries(
    DIMENSION_DEFINITIONS.map((d) => [d.key, { instructions: d.instructions, levels: [...d.levels] }])
  );
  const results = await askJevScores(resume.id, state, questions);

  return DIMENSION_DEFINITIONS.map((d) => ({
    key: d.key,
    label: d.label,
    weight: d.weight,
    rawScore: results[d.key].normalizedScore,
  }));
}

export async function scoreResume(
  resume: ExtractedResume,
  jd: JobDescription
): Promise<ScoreBreakdown> {
  const ruleChecks = runRuleChecks(resume, jd);
  const eligible = ruleChecks.every((check) => check.passed);
  const dimensions = await scoreDimensionsWithJev(resume, jd);
  const compositeScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.weight * d.rawScore, 0) * 100
  );

  return { resumeId: resume.id, ruleChecks, dimensions, compositeScore, eligible };
}

export interface ScoringMethodology {
  ruleChecks: Array<{ key: string; label: string; description: string }>;
  dimensions: Array<{
    key: string;
    label: string;
    weight: number;
    instructions: string;
    levels: string[];
  }>;
}

/**
 * Read-only description of exactly what gets checked in code (rule checks)
 * and exactly what gets asked of Jev (dimensions, with weight/instructions/
 * levels) -- sourced from the same definitions used to actually run scoring,
 * so this can never drift out of sync with what really happens.
 */
export function getScoringMethodology(): ScoringMethodology {
  return {
    ruleChecks: RULE_CHECK_DEFINITIONS.map((r) => ({ ...r })),
    dimensions: DIMENSION_DEFINITIONS.map((d) => ({
      key: d.key,
      label: d.label,
      weight: d.weight,
      instructions: d.instructions,
      levels: [...d.levels],
    })),
  };
}
