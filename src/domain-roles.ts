// Detect a project's domain from its brief, then specialize role titles and
// pick the skills that domain should build with.
export type DomainId =
  | 'web-app' | 'api' | 'mobile' | 'data' | 'cli-tool' | 'game' | 'ml' | 'generic';

export interface Domain {
  id: DomainId;
  label: string;
  // Role title overrides keyed by the generic role.
  roleTitles: { architect: string; executor: string; reviewer: string };
  // Skill names (see src/skills/) injected for every agent on this domain.
  skills: string[];
}

const DOMAINS: Record<DomainId, Domain> = {
  'web-app': {
    id: 'web-app', label: 'Web App',
    roleTitles: { architect: 'Backend Lead', executor: 'Frontend Lead', reviewer: 'QA Engineer' },
    skills: ['frontend', 'api-design', 'security-audit'],
  },
  'api': {
    id: 'api', label: 'API / Service',
    roleTitles: { architect: 'API Designer', executor: 'Implementation Lead', reviewer: 'Security Reviewer' },
    skills: ['api-design', 'security-audit', 'devops'],
  },
  'mobile': {
    id: 'mobile', label: 'Mobile App',
    roleTitles: { architect: 'App Architect', executor: 'UI Engineer', reviewer: 'QA Engineer' },
    skills: ['frontend', 'api-design'],
  },
  'data': {
    id: 'data', label: 'Data Pipeline',
    roleTitles: { architect: 'Data Engineer', executor: 'Pipeline Engineer', reviewer: 'Pipeline Reviewer' },
    skills: ['devops', 'security-audit'],
  },
  'cli-tool': {
    id: 'cli-tool', label: 'CLI Tool',
    roleTitles: { architect: 'CLI Architect', executor: 'Implementation Lead', reviewer: 'QA Engineer' },
    skills: ['devops'],
  },
  'game': {
    id: 'game', label: 'Game',
    roleTitles: { architect: 'Game Designer', executor: 'Gameplay Engineer', reviewer: 'Playtest Reviewer' },
    skills: ['frontend'],
  },
  'ml': {
    id: 'ml', label: 'ML Project',
    roleTitles: { architect: 'ML Architect', executor: 'ML Engineer', reviewer: 'Eval Reviewer' },
    skills: ['devops', 'security-audit'],
  },
  'generic': {
    id: 'generic', label: 'Software Project',
    roleTitles: { architect: 'Architect', executor: 'Executor', reviewer: 'Reviewer' },
    skills: [],
  },
};

// Ordered most-specific first; first matching group wins.
const SIGNALS: Array<{ id: DomainId; re: RegExp }> = [
  { id: 'ml',       re: /\b(machine learning|ml model|neural net|train(ing)? (a )?model|llm|fine.?tun|pytorch|tensorflow|classifier|embedding)\b/i },
  { id: 'game',     re: /\b(game|gameplay|player|level design|sprite|physics engine|2d|3d|roguelike|platformer)\b/i },
  { id: 'data',     re: /\b(data pipeline|etl|elt|ingest|warehouse|airflow|spark|batch job|stream(ing)? data|analytics pipeline)\b/i },
  { id: 'mobile',   re: /\b(mobile app|ios|android|react native|flutter|swiftui|kotlin app)\b/i },
  { id: 'cli-tool', re: /\b(cli|command.?line|terminal tool|shell tool|npx |argument parser)\b/i },
  { id: 'api',      re: /\b(rest api|graphql|api service|microservice|backend service|endpoint|webhook|grpc)\b/i },
  { id: 'web-app',  re: /\b(web app|website|dashboard|frontend|landing page|spa|next\.?js|react|vue|svelte|full.?stack)\b/i },
];

export function detectDomain(brief: string): Domain {
  for (const { id, re } of SIGNALS) {
    if (re.test(brief)) return DOMAINS[id];
  }
  return DOMAINS.generic;
}

export function domainSkills(domain: Domain, opts: { tdd?: boolean }): string[] {
  const names = [...domain.skills];
  if (opts.tdd) names.unshift('tdd');
  return [...new Set(names)];
}
