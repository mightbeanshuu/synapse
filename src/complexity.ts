import chalk from 'chalk';
import inquirer from 'inquirer';

export type ComplexityLevel = 'simple' | 'basic' | 'medium' | 'advanced';

export interface ComplexityProfile {
  level: ComplexityLevel;
  label: string;
  icon: string;
  description: string;
  techStack: string;
  constraints: string[];
}

export const COMPLEXITY: Record<ComplexityLevel, ComplexityProfile> = {
  simple: {
    level: 'simple', label: 'Simple', icon: '◌',
    description: 'Frontend only — HTML/CSS/JS, localStorage, opens in browser',
    techStack: 'HTML · CSS · Vanilla JS · localStorage (no server)',
    constraints: [
      'FRONTEND ONLY — no backend server, no API endpoints, no database server',
      'Use localStorage or IndexedDB for any data persistence',
      'Vanilla JS or CDN-loaded framework only — no build tools required',
      'Must open directly in browser with no server (just open index.html)',
      'Zero auth — no login system, no sessions',
      'If the brief mentions backend/database/auth, IGNORE those requirements entirely',
    ],
  },
  basic: {
    level: 'basic', label: 'Basic', icon: '◔',
    description: 'Minimal full-stack — one server, SQLite or file storage',
    techStack: 'Express/Flask · SQLite · Cookie sessions (no fancy stack)',
    constraints: [
      'Minimal backend — single simple framework only (Express, Flask, Fastify, etc.)',
      'SQLite or JSON file storage ONLY — no PostgreSQL, MySQL, or MongoDB',
      'Simple cookie/session auth if needed — no JWT, no OAuth providers',
      'Single deployable process — no Docker, no queues, no Redis, no caching layers',
      'Under 10 npm/pip packages total — keep the dependency tree flat',
    ],
  },
  medium: {
    level: 'medium', label: 'Medium', icon: '◑',
    description: 'Full-stack — real DB, auth, unit tests, deploy-ready',
    techStack: 'Next.js / Node · PostgreSQL or Supabase · Auth · Tests',
    constraints: [
      'Full-stack with clear separation of concerns (API layer + UI layer)',
      'Real database: PostgreSQL, Supabase, or MongoDB (no SQLite)',
      'Proper auth: JWT + refresh tokens, NextAuth, or Supabase Auth',
      'Unit tests for all critical business logic paths',
      'Environment-based config (.env), input validation, structured error handling',
    ],
  },
  advanced: {
    level: 'advanced', label: 'Advanced', icon: '●',
    description: 'Production-ready — scalable, CI/CD, monitored, Dockerised',
    techStack: 'Microservices / Monorepo · Docker · GitHub Actions · Observability',
    constraints: [
      'Production architecture — scalable, fault-tolerant, horizontally scalable',
      'Microservices or modular monolith with explicit bounded contexts',
      'Comprehensive tests: unit + integration + end-to-end',
      'Docker + CI/CD pipeline (GitHub Actions or equivalent)',
      'Observability: structured logging, health endpoints, error tracking',
      'Security: rate limiting, input validation, CSRF protection, security headers',
    ],
  },
};

// Returns the constraint block to prepend to any CLI preamble
export function buildConstraintBlock(profile: ComplexityProfile): string {
  return `
══════════════════════════════════════════════════════
COMPLEXITY: ${profile.label.toUpperCase()} — ${profile.description}
ALLOWED STACK: ${profile.techStack}
══════════════════════════════════════════════════════
HARD CONSTRAINTS — NEVER VIOLATE:
${profile.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

If the brief implies MORE complexity than this level, implement the SIMPLER version.
If the brief implies LESS complexity, stay at this level.
══════════════════════════════════════════════════════
`;
}

// Two template questions per complexity level (no Claude API call needed — instant)
export function getComplexityQuestions(level: ComplexityLevel): Array<{ label: string; hint: string }> {
  const map: Record<ComplexityLevel, Array<{ label: string; hint: string }>> = {
    simple: [
      { label: 'Features to include?',  hint: 'e.g. search, add/delete, filter, dark mode · Enter = all obvious ones' },
      { label: 'Anything to exclude?',  hint: 'e.g. no animations, no sound, keep it dead simple · Enter = nothing excluded' },
    ],
    basic: [
      { label: 'Core features?',        hint: 'e.g. CRUD, user accounts, comments · Enter = standard CRUD' },
      { label: 'Explicitly exclude?',   hint: 'e.g. no auth, no file uploads, no real-time · Enter = build everything obvious' },
    ],
    medium: [
      { label: 'Auth method?',          hint: 'e.g. email/password, Google OAuth, magic link, none · Enter = email/password' },
      { label: 'Specific integrations?',hint: 'e.g. Stripe, Supabase, Resend, tRPC, Prisma · Enter = standard stack' },
    ],
    advanced: [
      { label: 'Service breakdown?',    hint: 'e.g. auth-service, api-gateway, worker · Enter = start as modular monolith' },
      { label: 'Deployment target?',    hint: 'e.g. AWS ECS, Vercel + Railway, self-hosted · Enter = leave flexible' },
    ],
  };
  return map[level];
}

// Interactive prompt: pick complexity level
export async function pickComplexity(): Promise<ComplexityProfile> {
  const levels = Object.values(COMPLEXITY);
  const { level } = await inquirer.prompt<{ level: ComplexityLevel }>([{
    type: 'list',
    name: 'level',
    message: chalk.white('Project complexity:'),
    choices: levels.map(p => ({
      name: `${chalk.bold(p.icon)}  ${chalk.bold(p.label.padEnd(12))}${chalk.dim(p.description)}`,
      value: p.level,
    })),
    default: 'basic',
  }]);
  return COMPLEXITY[level];
}

// Collect answers to template questions and return a refinement string for the brief
export async function runComplexityQA(
  profile: ComplexityProfile,
): Promise<string> {
  const questions = getComplexityQuestions(profile.level);

  console.log('\n' + chalk.dim('  Two quick questions — Enter to skip either\n'));

  const extras: string[] = [];
  for (const q of questions) {
    const { answer } = await inquirer.prompt<{ answer: string }>([{
      type: 'input',
      name: 'answer',
      message: chalk.white(`  ${q.label}`),
      suffix: chalk.dim(` (${q.hint})`),
    }]);
    const a = answer.trim();
    if (a) extras.push(`${q.label} → ${a}`);
  }

  return extras.length > 0
    ? `\nUSER PREFERENCES:\n${extras.map(e => `• ${e}`).join('\n')}`
    : '';
}
