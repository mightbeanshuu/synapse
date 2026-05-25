// Pre-build idea reality check: before launching the CLIs, see how saturated the
// idea is by querying GitHub repositories and the npm registry. Degrades silently
// when offline — it should never block a build.

export interface RepoHit { name: string; stars: number; url: string; desc: string; }
export interface ValidationResult {
  ok: boolean;            // false when the lookup could not run (offline, etc.)
  score: number;          // reality_signal 0-100 (higher = more saturated)
  terms: string;
  topRepos: RepoHit[];
  npmPackages: string[];
  verdict: 'crowded' | 'competitive' | 'open' | 'unknown';
  suggestion: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'that', 'this', 'app', 'application',
  'build', 'create', 'make', 'simple', 'using', 'use', 'web', 'tool', 'project',
  'site', 'website', 'system', 'platform', 'let', 'lets', 'users', 'user', 'can',
  'should', 'allow', 'allows', 'their', 'your', 'has', 'have', 'will', 'into',
]);

export function extractTerms(brief: string, max = 4): string {
  const firstLine = brief.split('\n')[0];
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    picked.push(w);
    if (picked.length >= max) break;
  }
  return picked.join(' ');
}

async function fetchJSON(url: string, timeoutMs = 6000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'synapse-validator', Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function validateIdea(brief: string): Promise<ValidationResult> {
  const terms = extractTerms(brief);
  const base: ValidationResult = {
    ok: false, score: 0, terms, topRepos: [], npmPackages: [],
    verdict: 'unknown', suggestion: '',
  };
  if (!terms) return base;

  const q = encodeURIComponent(terms);
  const [gh, npm] = await Promise.all([
    fetchJSON(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=3`),
    fetchJSON(`https://registry.npmjs.org/-/v1/search?text=${q}&size=3`),
  ]);

  if (!gh && !npm) return base; // offline / rate-limited — skip quietly

  const topRepos: RepoHit[] = (gh?.items ?? []).slice(0, 3).map((r: any) => ({
    name: r.full_name,
    stars: r.stargazers_count ?? 0,
    url: r.html_url,
    desc: (r.description ?? '').slice(0, 80),
  }));
  const totalRepos = gh?.total_count ?? 0;
  const npmPackages: string[] = (npm?.objects ?? []).slice(0, 3).map((o: any) => o.package?.name).filter(Boolean);

  // reality_signal: blend top-repo popularity with how many things already exist.
  const maxStars = topRepos[0]?.stars ?? 0;
  const starScore = Math.min(60, Math.log10(maxStars + 1) * 15);     // 0..60
  const countScore = Math.min(25, Math.log10(totalRepos + 1) * 8);   // 0..25
  const npmScore = Math.min(15, npmPackages.length * 5);             // 0..15
  const score = Math.round(starScore + countScore + npmScore);

  let verdict: ValidationResult['verdict'];
  let suggestion: string;
  if (score > 70) {
    verdict = 'crowded';
    suggestion = 'This space is saturated. Pick a sharp niche or a differentiator the leaders ignore — otherwise you are rebuilding a solved problem.';
  } else if (score >= 30) {
    verdict = 'competitive';
    suggestion = 'Established players exist. Find one underserved angle and lean into it to stand out.';
  } else {
    verdict = 'open';
    suggestion = 'Relatively open space — proceed with confidence.';
  }

  return { ok: true, score, terms, topRepos, npmPackages, verdict, suggestion };
}
