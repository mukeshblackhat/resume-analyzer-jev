// Generates the dummy resume dataset used to exercise the Jev scoring
// pipeline at scale: 1000 PDFs in data/resumes/, built from a programmatic
// content generator (not hand-authored) so we get realistic variety in
// names, companies, skills, seniority, and fit-against-the-JD.
//
// Layout varies deliberately across three styles to stress-test the later
// PDF-text-extraction step: a clean sectioned resume is the easy case, but
// real resumes also show up as dense prose with no headers, or with skills
// collapsed into one inline line rather than bulleted -- extraction needs to
// survive all three.
//
// Alongside the PDFs, a ground-truth manifest (data/resumes-manifest.json)
// records each resume's intended fit tier, layout, and years of experience.
// That data is NEVER written into the PDF content itself -- it exists purely
// as a side channel so a downstream analysis can check the pipeline's actual
// Jev-derived scores against what we intended each resume to look like.
//
// Run: npx tsx scripts/generate-dummy-resumes.ts

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import jobDescription from "../data/job-description.json";

type Layout = "sectioned" | "dense" | "inline";
type FitTier = "strong" | "good" | "borderline" | "weak";

interface ExperienceEntry {
  title: string;
  company: string;
  years: string;
  bullets: string[];
}

interface ResumeContent {
  fileBaseName: string;
  layout: Layout;
  name: string;
  contact: string;
  summary: string;
  skills: string[];
  education: string[];
  experience: ExperienceEntry[];
  fitNote: string; // one-line human-readable note on intended fit vs the JD, printed to console only
  // Ground-truth fields for the manifest side-channel. Never rendered into
  // the PDF -- the render* functions below don't read these.
  fitTier: FitTier;
  yearsExperience: number;
}

interface ManifestEntry {
  id: string;
  name: string;
  fitTier: FitTier;
  layout: Layout;
  yearsExperience: number;
}

// ---------------------------------------------------------------------------
// Tiny seeded PRNG (mulberry32) so a given seed always reproduces the same
// 1000 resumes -- useful for re-running verification without the dataset
// shifting under us. Swap the seed to get a different draw.
// ---------------------------------------------------------------------------
type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260921;

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)];
}

/** Pick n distinct elements from arr (n <= arr.length). */
function pickN<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = randInt(rng, 0, pool.length - 1);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

// ---------------------------------------------------------------------------
// Name / location / company pools
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Priya", "Marcus", "Jessica", "Daniel", "Sara", "Tom", "Elena", "Brian", "Aisha", "Kevin",
  "Wei", "Fatima", "Diego", "Nora", "Omar", "Grace", "Liam", "Yuki", "Sofia", "Adrian",
  "Chidi", "Maya", "Ravi", "Ingrid", "Hassan", "Chloe", "Viktor", "Amara", "Jonas", "Leila",
  "Ethan", "Nadia", "Miguel", "Talia", "Sean", "Ana", "Felix", "Zara", "Owen", "Mei",
  "Carlos", "Renee", "Dmitri", "Layla", "Noah", "Priscilla", "Anton", "Farah", "Jack", "Ximena",
  "Tariq", "Hannah", "Kofi", "Ivy", "Lucas", "Nia", "Simon", "Aditi", "Caleb", "Rosa",
];

const LAST_NAMES = [
  "Raman", "Chen", "Lin", "Okafor", "Petrov", "Alvarez", "Vasquez", "Kelly", "Bello", "Wu",
  "Nguyen", "Haddad", "Torres", "Sorensen", "Farouk", "Bishop", "Sato", "Moreno", "Kessler", "Diallo",
  "Patel", "Ibrahim", "Costa", "Larsen", "Osei", "Mercer", "Volkov", "Adeyemi", "Novak", "Rahman",
  "Whitfield", "Suleiman", "Delgado", "Bergstrom", "Malhotra", "Fontaine", "Abara", "Kowalski", "Reyes", "Zhang",
  "Fitzgerald", "Nakamura", "Andersson", "Kimura", "O'Brien", "Salazar", "Winters", "Nkemelu", "Blackwood", "Serrano",
  "Hassan", "Marsh", "Owusu", "Callahan", "Ferreira", "Lindqvist", "Abbas", "Tran", "Beaumont", "Okoro",
];

const CITIES = [
  "Seattle, WA", "Austin, TX", "Chicago, IL", "Denver, CO", "Boston, MA", "Phoenix, AZ", "New York, NY",
  "Dallas, TX", "Atlanta, GA", "San Diego, CA", "Portland, OR", "Minneapolis, MN", "Raleigh, NC",
  "Columbus, OH", "Salt Lake City, UT", "Pittsburgh, PA", "Nashville, TN", "Charlotte, NC", "Tampa, FL",
  "San Jose, CA", "Sacramento, CA", "Kansas City, MO", "Indianapolis, IN", "Milwaukee, WI", "Richmond, VA",
  "Baltimore, MD", "Cincinnati, OH", "St. Louis, MO", "Albuquerque, NM", "Louisville, KY", "Providence, RI",
  "Boise, ID", "Tucson, AZ", "Omaha, NE", "Orlando, FL", "Detroit, MI", "Philadelphia, PA", "Houston, TX",
  "San Francisco, CA", "Las Vegas, NV", "Cleveland, OH",
];

const TECH_COMPANY_PREFIXES = [
  "Nimbus", "Vertex", "Ironwood", "Lattice", "Harborlight", "Cobalt", "Meridian", "Northbeam", "Slate",
  "Cinder", "Foundry", "Amber", "Crestline", "Silverline", "Bedrock", "Anchor", "Beacon", "Timberline",
  "Grayline", "Wrenfield", "Hollowbrook", "Larkspur", "Copperfield", "Windmere", "Sable", "Quartzline",
  "Driftwood", "Palodex", "Ashgrove", "Redbank",
];

const TECH_COMPANY_SUFFIXES = [
  "Systems", "Labs", "Technologies", "Cloud", "Data", "Analytics", "Software", "Solutions",
  "Networks", "Platform", "Infrastructure", "Computing", "Dynamics", "Digital",
];

const BIZ_COMPANY_PREFIXES = [
  "Brightleaf", "Riverside", "Crestpoint", "Bellwood", "Kindlewood", "Orbitleaf", "Coastline", "Mesquite",
  "Sonora", "Palisade", "Tidepool", "Ferro", "Cartwheel", "Ashford", "Thistledown", "Marrow", "Elmsworth",
  "Brackenridge", "Vineland", "Fieldstone", "Pixel & Pine", "Hazelmoor", "Cobblestone", "Sagebrook",
];

const BIZ_COMPANY_SUFFIXES = [
  "Media", "Consumer Goods", "Retail", "Studio", "Creative", "Consulting", "Group", "Partners",
  "Ventures", "Brands", "Care", "Agency", "Collective", "Holdings", "Logistics",
];

function makeCompanyName(rng: Rng, flavor: "tech" | "biz"): string {
  const prefixes = flavor === "tech" ? TECH_COMPANY_PREFIXES : BIZ_COMPANY_PREFIXES;
  const suffixes = flavor === "tech" ? TECH_COMPANY_SUFFIXES : BIZ_COMPANY_SUFFIXES;
  return `${pick(rng, prefixes)} ${pick(rng, suffixes)}`;
}

// ---------------------------------------------------------------------------
// Skill pools. BACKEND overlaps the JD directly; ADJACENT pools share a few
// skills with the JD but sit in a different specialization; UNRELATED pools
// share essentially nothing with it.
// ---------------------------------------------------------------------------

const JD_REQUIRED = jobDescription.requiredSkills as string[];
const JD_NICE_TO_HAVE = jobDescription.niceToHaveSkills as string[];

const BACKEND_EXTRA_SKILLS = [
  "Docker", "Microservices", "gRPC", "MySQL", "CI/CD", "Elasticsearch", "RabbitMQ", "System design",
  "Java", "Python",
];

type DomainKey = "backend" | "data" | "mobile" | "frontend" | "sales" | "marketing" | "design" | "support";

const DOMAIN_SKILLS: Record<DomainKey, string[]> = {
  backend: [...JD_REQUIRED, ...JD_NICE_TO_HAVE, ...BACKEND_EXTRA_SKILLS],
  data: ["Python", "Spark", "Airflow", "AWS", "Redshift", "PostgreSQL", "SQL", "ETL pipelines", "Snowflake", "dbt", "Kafka", "Distributed systems"],
  mobile: ["React Native", "Swift", "Kotlin", "TypeScript", "Node.js", "REST API design", "GraphQL", "iOS", "Android"],
  frontend: ["React", "TypeScript", "Node.js", "REST API design", "MongoDB", "JavaScript", "CSS3", "Next.js", "GraphQL", "HTML5"],
  sales: ["Salesforce", "Negotiation", "Account management", "Pipeline forecasting", "Cold outreach", "CRM tools", "Quota attainment"],
  marketing: ["Content strategy", "Google Analytics", "Email marketing", "Canva", "SEO basics", "Social media", "Campaign management", "HubSpot"],
  design: ["Figma", "UX research", "Wireframing", "Prototyping", "Adobe XD", "Visual design", "Design systems"],
  support: ["Zendesk", "Customer success", "Ticket triage", "Onboarding", "Technical support", "SLA management"],
};

// ---------------------------------------------------------------------------
// Education pools
// ---------------------------------------------------------------------------

const SCHOOLS = [
  "University of Washington", "UT Austin", "Northeastern University", "Georgia Tech", "UC San Diego",
  "Arizona State University", "Columbia University", "Rutgers University", "SMU", "Metro State University",
  "DePaul University", "University of Michigan", "Ohio State University", "Penn State University",
  "University of Florida", "University of Texas at Dallas", "Purdue University",
  "University of Illinois Urbana-Champaign", "University of Wisconsin-Madison", "University of Colorado Boulder",
  "Virginia Tech", "NC State University", "University of Maryland", "Boston University",
  "University of Pittsburgh", "Indiana University", "University of Utah", "University of Oregon",
  "Portland State University", "San Jose State University", "Cal Poly", "University of Minnesota",
  "Temple University", "University of Cincinnati", "Drexel University",
];

const TECHNICAL_FIELDS = ["Computer Science", "Computer Engineering", "Software Engineering", "Information Systems", "Electrical Engineering"];
const BUSINESS_FIELDS = ["Business Administration", "Marketing", "Communications", "Economics"];
const DESIGN_FIELDS = ["Digital Media", "Graphic Design", "Human-Computer Interaction", "Fine Arts"];
const SUPPORT_FIELDS = ["Business Administration", "Communications", "Psychology", "Human Resources"];

const CURRENT_YEAR = 2026;

type EducationLevel = "none" | "bachelors" | "masters" | "phd";

function fieldsForDomain(domain: DomainKey): string[] {
  switch (domain) {
    case "backend":
    case "data":
    case "mobile":
    case "frontend":
      return TECHNICAL_FIELDS;
    case "sales":
    case "marketing":
      return BUSINESS_FIELDS;
    case "design":
      return DESIGN_FIELDS;
    case "support":
      return SUPPORT_FIELDS;
  }
}

function degreeAbbrev(level: "bachelors" | "masters" | "phd", field: string): string {
  if (level === "phd") return `Ph.D. ${field}`;
  if (level === "masters") return `M.S. ${field}`;
  return field === "Business Administration" || field === "Communications" || field === "Marketing" || field === "Economics" || field === "Fine Arts"
    ? `B.A. ${field}`
    : `B.S. ${field}`;
}

function buildEducation(rng: Rng, domain: DomainKey, level: EducationLevel, yearsExperience: number): string[] {
  if (level === "none") {
    return rng() < 0.5 ? [] : [`Some coursework in ${pick(rng, fieldsForDomain(domain))}, no degree completed`];
  }
  const field = pick(rng, fieldsForDomain(domain));
  const school = pick(rng, SCHOOLS);
  const lines: string[] = [];
  if (level === "phd") {
    const phdYear = CURRENT_YEAR - yearsExperience - randInt(rng, 0, 1);
    const bsYear = phdYear - randInt(rng, 5, 7);
    lines.push(`${degreeAbbrev("phd", field)}, ${pick(rng, SCHOOLS)}, ${phdYear}`);
    lines.push(`${degreeAbbrev("bachelors", field)}, ${school}, ${bsYear}`);
  } else if (level === "masters") {
    const msYear = CURRENT_YEAR - yearsExperience - randInt(rng, 0, 1);
    const bsYear = msYear - randInt(rng, 2, 3);
    lines.push(`${degreeAbbrev("masters", field)}, ${pick(rng, SCHOOLS)}, ${msYear}`);
    lines.push(`${degreeAbbrev("bachelors", field)}, ${school}, ${bsYear}`);
  } else {
    const bsYear = CURRENT_YEAR - yearsExperience - randInt(rng, 0, 1);
    lines.push(`${degreeAbbrev("bachelors", field)}, ${school}, ${bsYear}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Title ladders per domain, indexed by seniority level (0 = entry .. 4 = principal)
// ---------------------------------------------------------------------------

const TITLE_LADDERS: Record<DomainKey, string[]> = {
  backend: ["Software Engineer I", "Backend Engineer", "Senior Backend Engineer", "Staff Backend Engineer", "Principal Backend Engineer"],
  data: ["Data Engineer I", "Data Engineer", "Senior Data Engineer", "Staff Data Engineer", "Principal Data Engineer"],
  mobile: ["Junior Mobile Engineer", "Mobile Engineer", "Senior Mobile Engineer", "Staff Mobile Engineer", "Principal Mobile Engineer"],
  frontend: ["Junior Frontend Developer", "Frontend Developer", "Senior Frontend Developer", "Staff Frontend Engineer", "Principal Frontend Engineer"],
  sales: ["Sales Development Rep", "Account Executive", "Senior Account Executive", "Enterprise Account Executive", "Director of Sales"],
  marketing: ["Marketing Intern", "Marketing Coordinator", "Marketing Manager", "Senior Marketing Manager", "Director of Marketing"],
  design: ["Junior Product Designer", "Product Designer", "Senior Product Designer", "Staff Product Designer", "Design Lead"],
  support: ["Support Associate", "Customer Support Specialist", "Senior Support Specialist", "Support Team Lead", "Support Manager"],
};

function seniorityLevel(yearsExperience: number): number {
  if (yearsExperience < 2) return 0;
  if (yearsExperience < 5) return 1;
  if (yearsExperience < 9) return 2;
  if (yearsExperience < 13) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Bullet templates per domain. Each takes the skills chosen for that role and
// a couple of random numbers, and returns a plausible resume bullet.
// ---------------------------------------------------------------------------

function metric(rng: Rng, min: number, max: number): number {
  return randInt(rng, min, max);
}

function skillOrFallback(skills: string[], idx: number, fallback: string): string {
  return skills[idx] ?? fallback;
}

/**
 * Pick the first skill that's actually typical for this bullet's phrasing
 * (e.g. don't let an overlap skill like "AWS" fill a frontend-specific
 * template such as "Built responsive AWS interfaces"). Falls back to a
 * sensible default when none of the role's skills match the allowlist.
 */
function pickTypical(skills: string[], allowlist: string[], fallback: string): string {
  return skills.find((s) => allowlist.includes(s)) ?? fallback;
}

const BULLET_BUILDERS: Record<DomainKey, ((rng: Rng, skills: string[], company: string) => string)[]> = {
  backend: [
    (rng, s) => `Built and maintained REST APIs in ${skillOrFallback(s, 0, "Node.js")} serving ${metric(rng, 50, 900)}K requests/day.`,
    (rng, s) => `Designed a ${skillOrFallback(s, 1, "PostgreSQL")}-backed data layer that cut p99 query latency by ${metric(rng, 20, 70)}%.`,
    (rng, s, c) => `Led migration of core services at ${c} onto ${skillOrFallback(s, 2, "AWS")}, improving uptime during peak load.`,
    (rng, s) => `Owned the ${skillOrFallback(s, 3, "Kafka")} event pipeline processing ${metric(rng, 5, 80)}M events/day.`,
    (rng, s) => `Introduced ${skillOrFallback(s, 4, "Terraform")}-managed infrastructure, cutting provisioning time by ${metric(rng, 40, 90)}%.`,
    (rng) => `Applied distributed-systems patterns to scale the platform to ${metric(rng, 20, 500)}K concurrent users.`,
    (rng, s) => `Designed internal ${skillOrFallback(s, 0, "REST API design")} standards used by ${metric(rng, 5, 40)}+ downstream services.`,
  ],
  data: [
    (rng, s) =>
      `Built ${pickTypical(s, ["Airflow", "Spark", "dbt"], "Airflow")}-orchestrated ETL pipelines moving ${metric(rng, 10, 500)}GB/day through ${pickTypical(s, ["Redshift", "Snowflake", "PostgreSQL"], "Redshift")}.`,
    (rng, s) => `Wrote ${pickTypical(s, ["Python"], "Python")} and ${pickTypical(s, ["Spark", "Airflow"], "Spark")} batch jobs to process large-scale event data.`,
    (rng, s, c) => `Maintained ${pickTypical(s, ["PostgreSQL", "Redshift", "Snowflake"], "PostgreSQL")} warehouses at ${c} supporting company-wide analytics dashboards.`,
    (rng, s) => `Coordinated distributed batch jobs across multiple regions on ${pickTypical(s, ["AWS"], "AWS")}.`,
  ],
  mobile: [
    (rng, s) => `Built the company's ${pickTypical(s, ["React Native", "Swift", "Kotlin"], "React Native")} app end to end, shipped to ${metric(rng, 10, 500)}K users.`,
    (rng, s) => `Wrote a lightweight ${pickTypical(s, ["Node.js", "TypeScript"], "Node.js")} BFF layer to aggregate REST calls for the mobile app.`,
    (rng, s) => `Maintained native modules in ${pickTypical(s, ["Swift"], "Swift")} and ${pickTypical(s, ["Kotlin"], "Kotlin")} for platform-specific features.`,
  ],
  frontend: [
    (rng, s) =>
      `Built responsive ${pickTypical(s, ["React", "Next.js", "JavaScript", "HTML5", "CSS3"], "React")} interfaces consumed by ${metric(rng, 5, 200)}K monthly users.`,
    (rng, s) => `Implemented ${pickTypical(s, ["TypeScript", "React", "Next.js"], "TypeScript")} component libraries shared across product teams.`,
    (rng, s, c) => `Partnered with backend engineers at ${c} to consume REST and GraphQL APIs.`,
  ],
  sales: [
    (rng, _s, c) => `Closed $${metric(rng, 1, 6)}M in annual recurring revenue across mid-market accounts at ${c}.`,
    (rng) => `Managed a book of ${metric(rng, 15, 60)}+ enterprise accounts.`,
    (rng) => `Exceeded quarterly quota by ${metric(rng, 10, 45)}% for four consecutive quarters.`,
    (rng) => `Built and ran a cold-outreach pipeline generating ${metric(rng, 20, 200)} qualified leads per month.`,
  ],
  marketing: [
    (rng) => `Managed social media calendars across ${metric(rng, 2, 8)} brand accounts.`,
    (rng) => `Coordinated email campaigns reaching ${metric(rng, 20, 400)}K subscribers.`,
    (rng, _s, c) => `Ran paid acquisition campaigns at ${c}, improving conversion rate by ${metric(rng, 5, 40)}%.`,
    (rng) => `Produced content strategy and SEO improvements that grew organic traffic by ${metric(rng, 10, 60)}%.`,
  ],
  design: [
    (rng) => `Designed and prototyped features in Figma used by ${metric(rng, 3, 30)}+ engineers to build against.`,
    (rng, _s, c) => `Led UX research at ${c} informing the redesign of the core product flow.`,
    () => `Built and maintained the company's design system components and guidelines.`,
  ],
  support: [
    (rng) => `Resolved an average of ${metric(rng, 20, 90)} customer tickets per week via Zendesk.`,
    (rng, _s, c) => `Maintained a customer satisfaction score above ${metric(rng, 88, 98)}% at ${c}.`,
    (rng) => `Onboarded new enterprise customers, reducing time-to-first-value by ${metric(rng, 10, 40)}%.`,
  ],
};

/**
 * Pick `count` bullet templates for this role, preferring ones not already
 * used elsewhere in the same resume (tracked via `usedIndices`) so a single
 * person's multiple roles don't repeat the exact same bullet line.
 */
function buildBullets(
  rng: Rng,
  domain: DomainKey,
  skills: string[],
  company: string,
  count: number,
  usedIndices: Set<number>
): string[] {
  const builders = BULLET_BUILDERS[domain];
  const allIndices = shuffle(rng, builders.map((_, i) => i));
  const unused = allIndices.filter((i) => !usedIndices.has(i));
  const ordered = [...unused, ...allIndices.filter((i) => usedIndices.has(i))];
  const chosen = ordered.slice(0, count);
  chosen.forEach((i) => usedIndices.add(i));
  return chosen.map((i) => builders[i](rng, skills, company));
}

// ---------------------------------------------------------------------------
// Role / years-of-experience composition
// ---------------------------------------------------------------------------

function rolesCountFor(rng: Rng, years: number): number {
  if (years <= 2) return 1;
  if (years <= 5) return randInt(rng, 1, 2);
  if (years <= 9) return randInt(rng, 2, 3);
  return randInt(rng, 3, 4);
}

/** Split `total` years across `count` roles (most recent first), each >= 1 year. */
function splitYears(rng: Rng, total: number, count: number): number[] {
  if (count === 1) return [total];
  const durations: number[] = [];
  let remaining = total;
  for (let i = 0; i < count - 1; i++) {
    const roomForRest = remaining - (count - 1 - i);
    const maxDur = Math.max(1, Math.min(4, roomForRest));
    const dur = randInt(rng, 1, maxDur);
    durations.push(dur);
    remaining -= dur;
  }
  durations.push(Math.max(1, remaining));
  return durations;
}

function buildExperience(rng: Rng, domain: DomainKey, skills: string[], years: number): ExperienceEntry[] {
  const roleCount = rolesCountFor(rng, years);
  const durations = splitYears(rng, Math.max(years, roleCount), roleCount);
  const ladder = TITLE_LADDERS[domain];
  const baseLevel = seniorityLevel(years);
  const flavor: "tech" | "biz" = ["backend", "data", "mobile", "frontend"].includes(domain) ? "tech" : "biz";

  const entries: ExperienceEntry[] = [];
  const usedBulletIndices = new Set<number>(); // dedup bullet lines across this person's roles
  let end = CURRENT_YEAR;
  for (let i = 0; i < roleCount; i++) {
    const dur = durations[i];
    const start = end - dur;
    const level = Math.max(0, Math.min(ladder.length - 1, baseLevel - i));
    const roleSkills = pickN(rng, skills, Math.min(skills.length, randInt(rng, 2, 4)));
    const company = makeCompanyName(rng, flavor);
    entries.push({
      title: ladder[level],
      company,
      years: `${start}-${end}`,
      bullets: buildBullets(rng, domain, roleSkills, company, randInt(rng, 1, 3), usedBulletIndices),
    });
    end = start;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Fit-tier composition. Each tier maps to a coherent domain + years + skill
// overlap + education profile rather than shuffling unrelated fields.
// ---------------------------------------------------------------------------

interface TierProfile {
  domain: DomainKey;
  years: number;
  skills: string[];
  fitNote: string;
}

function buildTierProfile(rng: Rng, tier: FitTier): TierProfile {
  switch (tier) {
    case "strong": {
      const years = randInt(rng, 5, 16);
      const required = pickN(rng, JD_REQUIRED, randInt(rng, 5, JD_REQUIRED.length));
      const nice = pickN(rng, JD_NICE_TO_HAVE, randInt(rng, 1, 4));
      const extra = pickN(rng, BACKEND_EXTRA_SKILLS, randInt(rng, 0, 3));
      return {
        domain: "backend",
        years,
        skills: shuffle(rng, [...required, ...nice, ...extra]),
        fitNote: `Strong match: ${years} yrs, ${required.length}/${JD_REQUIRED.length} required skills + ${nice.length} nice-to-have.`,
      };
    }
    case "good": {
      const years = randInt(rng, 4, 9);
      const required = pickN(rng, JD_REQUIRED, randInt(rng, 3, 5));
      const nice = pickN(rng, JD_NICE_TO_HAVE, randInt(rng, 0, 3));
      const extra = pickN(rng, BACKEND_EXTRA_SKILLS, randInt(rng, 0, 2));
      return {
        domain: "backend",
        years,
        skills: shuffle(rng, [...required, ...nice, ...extra]),
        fitNote: `Good/borderline-strong: ${years} yrs, ${required.length}/${JD_REQUIRED.length} required skills.`,
      };
    }
    case "borderline": {
      if (rng() < 0.6) {
        // Adjacent domain with partial overlap.
        const domain = pick(rng, ["data", "mobile", "frontend"] as const);
        const years = randInt(rng, 3, 8);
        const domainSkills = pickN(rng, DOMAIN_SKILLS[domain], randInt(rng, 4, 7));
        const overlap = pickN(rng, JD_REQUIRED, randInt(rng, 1, 3));
        return {
          domain,
          years,
          skills: shuffle(rng, [...domainSkills, ...overlap]),
          fitNote: `Borderline: ${years} yrs, adjacent ${domain} domain with partial overlap on ${overlap.join(", ")}.`,
        };
      }
      // Backend domain but below the minimum years.
      const years = randInt(rng, 1, 4);
      const required = pickN(rng, JD_REQUIRED, randInt(rng, 3, 6));
      const nice = pickN(rng, JD_NICE_TO_HAVE, randInt(rng, 0, 2));
      return {
        domain: "backend",
        years,
        skills: shuffle(rng, [...required, ...nice]),
        fitNote: `Borderline: only ${years} yrs (below ${jobDescription.minYearsExperience}-yr minimum), otherwise on-domain.`,
      };
    }
    case "weak": {
      if (rng() < 0.75) {
        const domain = pick(rng, ["sales", "marketing", "design", "support"] as const);
        const years = randInt(rng, 1, 9);
        const skills = pickN(rng, DOMAIN_SKILLS[domain], randInt(rng, 4, 6));
        return {
          domain,
          years,
          skills: shuffle(rng, skills),
          fitNote: `No match: ${years} yrs but unrelated ${domain} domain.`,
        };
      }
      // Very junior generalist (frontend-leaning), minimal experience.
      const years = randInt(rng, 0, 2);
      const skills = pickN(rng, DOMAIN_SKILLS.frontend, randInt(rng, 3, 5));
      return {
        domain: "frontend",
        years,
        skills: shuffle(rng, skills),
        fitNote: `No match: ${years} yrs, junior frontend-only, no backend experience.`,
      };
    }
  }
}

function educationLevelFor(rng: Rng, years: number): EducationLevel {
  if (years === 0 && rng() < 0.4) return "none";
  if (years >= 10 && rng() < 0.3) return "phd";
  if (years >= 6 && rng() < 0.4) return "masters";
  if (rng() < 0.08) return "none";
  return "bachelors";
}

function buildSummary(rng: Rng, domain: DomainKey, years: number, skills: string[], tier: FitTier): string {
  const ladder = TITLE_LADDERS[domain];
  const level = seniorityLevel(years);
  const roleNoun = ladder[level].replace(/^(Junior|Senior|Staff|Principal|Enterprise) /, "");
  const topSkills = skills.slice(0, 3).join(", ") || "a range of tools";
  const yearsPhrase = years === 0 ? "just starting out" : `${years} year${years === 1 ? "" : "s"} of experience`;

  if (domain === "backend") {
    if (tier === "strong" || tier === "good") {
      return `${["Senior", "Experienced", "Results-driven"][randInt(rng, 0, 2)]} ${roleNoun.toLowerCase()} with ${yearsPhrase} building backend systems on ${topSkills}.`;
    }
    return `Backend-leaning engineer with ${yearsPhrase}, working primarily with ${topSkills}.`;
  }
  if (domain === "data") return `Data engineer with ${yearsPhrase}, focused on pipelines and warehousing using ${topSkills}.`;
  if (domain === "mobile") return `Mobile engineer with ${yearsPhrase} building apps with ${topSkills}, some backend exposure.`;
  if (domain === "frontend") return `Frontend${years <= 2 ? "/junior " : " "}developer with ${yearsPhrase} in ${topSkills}.`;
  if (domain === "sales") return `B2B sales professional with ${yearsPhrase} in enterprise software sales.`;
  if (domain === "marketing") return `Marketing professional with ${yearsPhrase} in campaign management and growth.`;
  if (domain === "design") return `Product designer with ${yearsPhrase}, focused on ${topSkills}.`;
  return `Customer support specialist with ${yearsPhrase} helping customers succeed.`;
}

// A dense-layout resume folds everything into one flowing paragraph instead
// of the structured fields, mirroring the two hand-authored dense examples
// this replaces (Marcus Chen / Tom Alvarez in the original 10).
function lowerFirst(text: string): string {
  return text.length ? text[0].toLowerCase() + text.slice(1) : text;
}

function stripTrailingPeriod(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

function buildDenseSummary(rng: Rng, name: string, domain: DomainKey, years: number, skills: string[], experience: ExperienceEntry[], education: string[]): string {
  const roleParts = experience.map((e) => `${e.title} at ${e.company} (${e.years})`);
  const firstBullet = experience[0]?.bullets[0];
  const historyPhrase =
    roleParts.length > 0
      ? `Most recently, ${roleParts[0]}${firstBullet ? `, where they ${lowerFirst(stripTrailingPeriod(firstBullet))}.` : "."} ` +
        roleParts
          .slice(1)
          .map((p) => `Before that, ${p}.`)
          .join(" ")
      : "";
  const eduPhrase = education.length ? `Education: ${education.join("; ")}. ` : "";
  const skillsPhrase = skills.length ? `Core skills: ${skills.join(", ")}.` : "";
  return `${name} has ${years} year${years === 1 ? "" : "s"} of experience in ${domain === "backend" ? "backend and distributed systems" : domain}. ${historyPhrase} ${eduPhrase}${skillsPhrase}`.replace(/\s+/g, " ").trim();
}

const FIT_TIER_WEIGHTS: Record<FitTier, number> = { strong: 0.12, good: 0.18, borderline: 0.3, weak: 0.4 };
const LAYOUT_WEIGHTS: Record<Layout, number> = { dense: 0.17, sectioned: 0.5, inline: 0.33 };

/** Build an exact-count assignment array matching target weights over `total` items, then shuffle. */
function weightedAssignment<T extends string>(rng: Rng, weights: Record<T, number>, total: number): T[] {
  const keys = Object.keys(weights) as T[];
  const counts = keys.map((k) => Math.round(weights[k] * total));
  // Correct rounding drift against the last bucket so counts sum exactly to `total`.
  const drift = total - counts.reduce((a, b) => a + b, 0);
  counts[counts.length - 1] += drift;
  const out: T[] = [];
  keys.forEach((k, i) => {
    for (let n = 0; n < counts[i]; n++) out.push(k);
  });
  return shuffle(rng, out);
}

function buildResume(rng: Rng, index: number, tier: FitTier, layout: Layout, usedEmails: Set<string>): ResumeContent {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  const name = `${first} ${last}`;

  const emailBase = `${first.toLowerCase()}.${last.toLowerCase()}`.replace(/[^a-z.]/g, "");
  let email = `${emailBase}@example.com`;
  if (usedEmails.has(email)) {
    email = `${emailBase}${index}@example.com`;
  }
  usedEmails.add(email);
  const contact = `${email} | ${pick(rng, CITIES)}`;

  const profile = buildTierProfile(rng, tier);
  const experience = buildExperience(rng, profile.domain, profile.skills, profile.years);
  const eduLevel = educationLevelFor(rng, profile.years);
  const education = buildEducation(rng, profile.domain, eduLevel, profile.years);
  const summary =
    layout === "dense"
      ? buildDenseSummary(rng, name, profile.domain, profile.years, profile.skills, experience, education)
      : buildSummary(rng, profile.domain, profile.years, profile.skills, tier);

  return {
    fileBaseName: `resume-${pad4(index)}`,
    layout,
    name,
    contact,
    summary,
    // Dense layout folds skills/education/experience into the summary prose,
    // matching how renderDenseParagraph only ever reads name/contact/summary.
    skills: layout === "dense" ? [] : profile.skills,
    education: layout === "dense" ? [] : education,
    experience: layout === "dense" ? [] : experience,
    fitNote: profile.fitNote,
    fitTier: tier,
    yearsExperience: profile.years,
  };
}

function generateResumes(count: number): ResumeContent[] {
  const rng = mulberry32(SEED);
  const tiers = weightedAssignment(rng, FIT_TIER_WEIGHTS, count);
  const layouts = weightedAssignment(rng, LAYOUT_WEIGHTS, count);
  const usedEmails = new Set<string>();
  const resumes: ResumeContent[] = [];
  for (let i = 0; i < count; i++) {
    resumes.push(buildResume(rng, i + 1, tiers[i], layouts[i], usedEmails));
  }
  return resumes;
}

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 14;

/** Greedy word-wrap against actual glyph widths so lines never overflow the page. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Thin wrapper around pdf-lib that handles line-by-line writing and pagination. */
class ResumePdfWriter {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private y = 0;
  private regular!: PDFFont;
  private bold!: PDFFont;

  async init(font: "helvetica" | "courier") {
    this.doc = await PDFDocument.create();
    this.regular = await this.doc.embedFont(
      font === "courier" ? StandardFonts.Courier : StandardFonts.Helvetica
    );
    this.bold = await this.doc.embedFont(
      font === "courier" ? StandardFonts.CourierBold : StandardFonts.HelveticaBold
    );
    this.addPage();
  }

  private addPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(lines: number) {
    if (this.y - lines * LINE_HEIGHT < MARGIN) this.addPage();
  }

  writeHeading(text: string, size = 16) {
    this.ensureSpace(2);
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font: this.bold, color: rgb(0, 0, 0) });
    this.y -= size + 6;
  }

  writeSectionTitle(text: string) {
    this.ensureSpace(2);
    this.y -= 4;
    this.page.drawText(text.toUpperCase(), {
      x: MARGIN,
      y: this.y,
      size: 11,
      font: this.bold,
      color: rgb(0.15, 0.15, 0.15),
    });
    this.y -= LINE_HEIGHT;
  }

  writeParagraph(text: string, indent = 0) {
    const maxWidth = PAGE_WIDTH - 2 * MARGIN - indent;
    const lines = wrapText(text, this.regular, BODY_SIZE, maxWidth);
    this.ensureSpace(lines.length);
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size: BODY_SIZE, font: this.regular });
      this.y -= LINE_HEIGHT;
    }
  }

  writeBullet(text: string) {
    this.writeParagraph(`- ${text}`, 10);
  }

  spacer(amount = 6) {
    this.y -= amount;
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

async function renderSectioned(r: ResumeContent): Promise<Uint8Array> {
  const w = new ResumePdfWriter();
  await w.init("helvetica");
  w.writeHeading(r.name);
  w.writeParagraph(r.contact);
  w.spacer();
  w.writeSectionTitle("Summary");
  w.writeParagraph(r.summary);
  w.spacer();
  w.writeSectionTitle("Experience");
  for (const job of r.experience) {
    w.writeParagraph(`${job.title} - ${job.company} (${job.years})`);
    for (const bullet of job.bullets) w.writeBullet(bullet);
    w.spacer(4);
  }
  w.writeSectionTitle("Education");
  for (const line of r.education) w.writeParagraph(line);
  w.spacer();
  w.writeSectionTitle("Skills");
  for (const skill of r.skills) w.writeBullet(skill);
  return w.save();
}

async function renderDenseParagraph(r: ResumeContent): Promise<Uint8Array> {
  // No headers, no bullets, everything folded into flowing prose -- and a
  // different font -- to stress the extraction step against messy real-world formatting.
  const w = new ResumePdfWriter();
  await w.init("courier");
  w.writeHeading(r.name, 14);
  w.writeParagraph(r.contact);
  w.spacer();
  w.writeParagraph(r.summary);
  return w.save();
}

async function renderInlineSkills(r: ResumeContent): Promise<Uint8Array> {
  const w = new ResumePdfWriter();
  await w.init("helvetica");
  w.writeHeading(r.name);
  w.writeParagraph(r.contact);
  w.spacer();
  w.writeSectionTitle("Summary");
  w.writeParagraph(r.summary);
  w.spacer();
  w.writeSectionTitle("Experience");
  for (const job of r.experience) {
    w.writeParagraph(`${job.title}, ${job.company} (${job.years})`);
    for (const bullet of job.bullets) w.writeBullet(bullet);
    w.spacer(4);
  }
  w.writeSectionTitle("Education");
  for (const line of r.education) w.writeParagraph(line);
  w.spacer();
  // Skills collapsed into a single inline line rather than bulleted.
  w.writeParagraph(`Skills: ${r.skills.join(", ")}.`);
  return w.save();
}

async function renderResume(r: ResumeContent): Promise<Uint8Array> {
  switch (r.layout) {
    case "sectioned":
      return renderSectioned(r);
    case "dense":
      return renderDenseParagraph(r);
    case "inline":
      return renderInlineSkills(r);
  }
}

const RESUME_COUNT = 1000;

async function main() {
  const outDir = path.join(process.cwd(), "data", "resumes");
  mkdirSync(outDir, { recursive: true });

  // Clean out the old 10-resume naming scheme (resume-01..resume-10) and any
  // stale PDFs from a previous run so the directory only ever holds the
  // current 4-digit-numbered set.
  for (const entry of readdirSync(outDir)) {
    if (entry.endsWith(".pdf")) rmSync(path.join(outDir, entry));
  }

  const resumes = generateResumes(RESUME_COUNT);

  console.log(`Generating ${resumes.length} dummy resumes into ${outDir}\n`);
  const manifest: ManifestEntry[] = [];
  for (const r of resumes) {
    const bytes = await renderResume(r);
    const outPath = path.join(outDir, `${r.fileBaseName}.pdf`);
    writeFileSync(outPath, bytes);
    manifest.push({
      id: r.fileBaseName,
      name: r.name,
      fitTier: r.fitTier,
      layout: r.layout,
      yearsExperience: r.yearsExperience,
    });
    if (Number(r.fileBaseName.split("-")[1]) % 100 === 0) {
      console.log(`  ...${r.fileBaseName}.pdf  [${r.layout}]  ${r.name} - ${r.fitNote}`);
    }
  }

  const manifestPath = path.join(process.cwd(), "data", "resumes-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote manifest: ${manifestPath}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("generate-dummy-resumes failed:", err);
  process.exit(1);
});
