import fs from 'fs';
import path from 'path';

// Session memory persists what was built so a later Synapse run on the same
// project dir starts informed instead of re-deriving the codebase.
function contextFile(projectDir: string): string {
  return path.join(projectDir, '.synapse', 'CONTEXT.md');
}

export interface SessionContext {
  brief: string;
  techStack: string;
  clis: string;
  files: string[];
}

export function saveContext(projectDir: string, ctx: SessionContext): void {
  try {
    const dir = path.join(projectDir, '.synapse');
    fs.mkdirSync(dir, { recursive: true });
    const fileList = ctx.files.slice(0, 60).map(f => `- ${f}`).join('\n');
    const body = [
      `# Synapse Project Context`,
      `_Last session: ${new Date().toISOString()}_`,
      '',
      `## Brief`,
      ctx.brief,
      '',
      `## Tech Stack`,
      ctx.techStack,
      '',
      `## Built By`,
      ctx.clis,
      '',
      `## Files In Project`,
      fileList || '_(none recorded)_',
      '',
    ].join('\n');
    fs.writeFileSync(contextFile(projectDir), body);
  } catch {}
}

// Returns an injectable block describing prior work, or null on a fresh project.
export function loadContext(projectDir: string): string | null {
  try {
    const f = contextFile(projectDir);
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, 'utf8').trim();
    if (!raw) return null;
    return `══════════════════════════════════════════════════════
EXISTING PROJECT CONTEXT — this directory was built before
══════════════════════════════════════════════════════
A previous Synapse session already worked here. Read the real files to confirm,
but start from this summary instead of rebuilding from scratch:

${raw}
══════════════════════════════════════════════════════`;
  } catch {
    return null;
  }
}

// Walk the project dir for a file list to record (skips noise).
export function listProjectFiles(projectDir: string): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', '.synapse', 'dist', 'build', '.next', 'output']);
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else out.push(path.relative(projectDir, full));
      if (out.length > 200) return;
    }
  };
  walk(projectDir, 0);
  return out;
}
