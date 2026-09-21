// Fully local PDF -> structured resume data. No external API call: field
// structuring is done with plain-text heuristics against our own generator's
// known layouts (section headers SUMMARY/EXPERIENCE/EDUCATION/SKILLS, or an
// inline "Skills: a, b, c." line) -- not an LLM. This removes the Vercel AI
// Gateway dependency from extraction entirely.
//
// Known, accepted tradeoff: resumes written as unstructured prose with no
// section headers (the "dense" layout in scripts/generate-dummy-resumes.ts,
// deliberately built to stress-test extraction) can't be reliably parsed by
// regex/heuristics alone -- that's exactly the kind of input an LLM-based
// extractor exists to handle. For those we still recover a years-of-experience
// estimate from any year range mentioned in the text, but skills/education/
// experience come back sparse. This is honest, not a bug to "fix" with more
// regex -- more heuristics can't substitute for actually reading prose.

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type { ExtractedResume } from "./types";

const SECTION_HEADERS = ["SUMMARY", "EXPERIENCE", "EDUCATION", "SKILLS"] as const;
type SectionName = (typeof SECTION_HEADERS)[number];
type Sections = Partial<Record<SectionName, string[]>>;

async function extractRawText(filePath: string): Promise<string> {
  const data = readFileSync(filePath);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

// pdf-parse inserts a page-separator line like "-- 1 of 1 --" between pages;
// strip it so it never leaks into a section's content.
const PAGE_MARKER = /^--\s*\d+\s+of\s+\d+\s*--$/i;

/** First line is always the candidate's name; section bodies are grouped under their all-caps header line. */
function splitSections(text: string): { name: string; sections: Sections } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !PAGE_MARKER.test(l));
  const name = lines[0] ?? "";
  const sections: Sections = {};
  let current: SectionName | null = null;

  for (const line of lines.slice(1)) {
    if ((SECTION_HEADERS as readonly string[]).includes(line)) {
      current = line as SectionName;
      sections[current] = [];
      continue;
    }
    if (current) sections[current]!.push(line);
  }

  return { name, sections };
}

function parseInlineSkillsLine(line: string): string[] {
  return line
    .replace(/^skills:/i, "")
    .replace(/\.$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The "inline" generator layout writes a bare "Skills: a, b, c." line with no
 * preceding SKILLS header, so it lands inside whatever section came before it
 * (EDUCATION, per generate-dummy-resumes.ts) rather than its own section.
 * Search every section for that line, wherever it ended up, and strip it out
 * of its host section afterward so it doesn't pollute e.g. education.
 */
function extractSkills(sections: Sections): string[] {
  if (sections.SKILLS) {
    const inline = sections.SKILLS.find((l) => /^skills:/i.test(l));
    if (inline) return parseInlineSkillsLine(inline);
    const bulleted = sections.SKILLS.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
    if (bulleted.length > 0) return bulleted;
  }

  for (const name of Object.keys(sections) as SectionName[]) {
    const lines = sections[name]!;
    const index = lines.findIndex((l) => /^skills:/i.test(l));
    if (index !== -1) {
      const skills = parseInlineSkillsLine(lines[index]);
      lines.splice(index, 1);
      return skills;
    }
  }

  return [];
}

const EXPERIENCE_HEADER = /^(.*?)\s*[-,]\s*(.*?)\s*\(([^)]+)\)\s*$/;
const YEAR_RANGE = /\b(19|20)\d{2}\s*-\s*((19|20)\d{2}|present)\b/gi;

function parseYearSpan(range: string): number {
  const match = /(\d{4})\s*-\s*(\d{4}|present)/i.exec(range);
  if (!match) return 0;
  const start = Number(match[1]);
  const end = match[2].toLowerCase() === "present" ? new Date().getFullYear() : Number(match[2]);
  return Math.max(0, end - start);
}

function extractExperience(lines: string[] | undefined): ExtractedResume["experience"] {
  if (!lines) return [];
  const entries: ExtractedResume["experience"] = [];
  let current: ExtractedResume["experience"][number] | null = null;

  for (const line of lines) {
    const header = EXPERIENCE_HEADER.exec(line);
    if (header) {
      if (current) entries.push(current);
      const [, title, company, years] = header;
      current = { title: title.trim(), company: company.trim(), years: parseYearSpan(years), description: "" };
      continue;
    }
    if (current) {
      const text = line.startsWith("- ") ? line.slice(2).trim() : line;
      current.description = current.description ? `${current.description} ${text}` : text;
    }
  }
  if (current) entries.push(current);
  return entries;
}

/** Fallback for unstructured text with no section headers: recover a total-years estimate from any year ranges mentioned anywhere in the raw text. */
function estimateYearsFromWholeText(text: string): number {
  const ranges = [...text.matchAll(YEAR_RANGE)];
  const years = ranges.flatMap((m) => {
    const range = /(\d{4})\s*-\s*(\d{4}|present)/i.exec(m[0]);
    if (!range) return [];
    const end = range[2].toLowerCase() === "present" ? new Date().getFullYear() : Number(range[2]);
    return [Number(range[1]), end];
  });
  return years.length ? Math.max(...years) - Math.min(...years) : 0;
}

function estimateYearsExperience(
  sections: Sections,
  experience: ExtractedResume["experience"],
  rawText: string
): number {
  const summaryText = (sections.SUMMARY ?? []).join(" ");
  const explicit = /(\d+)\+?\s*years?/i.exec(summaryText);
  if (explicit) return Number(explicit[1]);
  if (experience.length > 0) return experience.reduce((sum, e) => sum + e.years, 0);
  return estimateYearsFromWholeText(rawText);
}

export async function extractResume(filePath: string): Promise<ExtractedResume> {
  const fileName = path.basename(filePath);
  const id = path.basename(filePath, path.extname(filePath));

  const rawText = await extractRawText(filePath);
  if (!rawText.trim()) {
    throw new Error(`extractResume: no text could be extracted from "${fileName}"`);
  }

  const { name, sections } = splitSections(rawText);
  const skills = extractSkills(sections);
  const education = sections.EDUCATION ?? [];
  const experience = extractExperience(sections.EXPERIENCE);
  const yearsExperience = estimateYearsExperience(sections, experience, rawText);

  return { id, fileName, name, yearsExperience, skills, education, experience, rawText };
}
