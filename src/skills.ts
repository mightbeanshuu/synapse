import fs from 'fs';
import path from 'path';

export interface Skill {
  name: string;
  title: string;
  description: string;
  body: string;
}

const BUILTIN_DIR = path.join(__dirname, 'skills');

// ── Minimal frontmatter parser (name/title/description + markdown body) ───────
function parseSkill(raw: string, fallbackName: string): Skill {
  let name = fallbackName, title = fallbackName, description = '';
  let body = raw;
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fm) {
    body = fm[2].trim();
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (k === 'name') name = v.trim();
      else if (k === 'title') title = v.trim();
      else if (k === 'description') description = v.trim();
    }
  }
  return { name, title, description, body };
}

function loadDir(dir: string): Skill[] {
  if (!fs.existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      out.push(parseSkill(raw, f.replace(/\.md$/, '')));
    } catch {}
  }
  return out;
}

// Built-in skills, plus user-extensible skills from <projectDir>/.synapse/skills/*.md
// (project skills override built-ins with the same name).
export function loadSkills(projectDir?: string): Map<string, Skill> {
  const map = new Map<string, Skill>();
  for (const s of loadDir(BUILTIN_DIR)) map.set(s.name, s);
  if (projectDir) {
    for (const s of loadDir(path.join(projectDir, '.synapse', 'skills'))) map.set(s.name, s);
  }
  return map;
}

export function availableSkillNames(projectDir?: string): string[] {
  return [...loadSkills(projectDir).keys()].sort();
}

// Render selected skills into a single injectable preamble block.
export function renderSkills(names: string[], projectDir?: string): string {
  if (names.length === 0) return '';
  const all = loadSkills(projectDir);
  const chosen = names.map(n => all.get(n)).filter(Boolean) as Skill[];
  if (chosen.length === 0) return '';
  const blocks = chosen.map(s => `### SKILL · ${s.title}\n${s.body}`).join('\n\n');
  return `══════════════════════════════════════════════════════
ACTIVE SKILLS — apply these throughout your work
══════════════════════════════════════════════════════
${blocks}
══════════════════════════════════════════════════════`;
}
