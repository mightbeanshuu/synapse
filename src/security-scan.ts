import fs from 'fs';
import path from 'path';

export interface Finding {
  severity: 'critical' | 'warning' | 'info';
  rule: string;
  file: string;
  line: number;
  excerpt: string;
}

interface Rule {
  severity: Finding['severity'];
  rule: string;
  re: RegExp;
  // Skip lines that look like false positives (env reads, placeholders, examples).
  ignore?: RegExp;
}

const RULES: Rule[] = [
  {
    severity: 'critical', rule: 'Hardcoded secret',
    re: /(api[_-]?key|secret|password|passwd|token|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    ignore: /process\.env|import\.meta\.env|os\.environ|getenv|example|placeholder|your[_-]?|xxx|<.*>|\$\{/i,
  },
  {
    severity: 'critical', rule: 'AWS access key',
    re: /AKIA[0-9A-Z]{16}/,
  },
  {
    severity: 'critical', rule: 'Private key block',
    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    severity: 'warning', rule: 'Possible SQL injection (string-built query)',
    re: /(query|execute)\s*\(\s*[`'"].*(SELECT|INSERT|UPDATE|DELETE).*(\+|\$\{|%s|f['"])/is,
  },
  {
    severity: 'warning', rule: 'Open CORS (wildcard origin)',
    re: /(Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*|cors\(\s*\{\s*origin\s*:\s*['"]\*)/i,
  },
  {
    severity: 'warning', rule: 'Dangerous eval / shell',
    re: /\b(eval\(|child_process.*exec\(|os\.system\(|subprocess\.call\(.*shell\s*=\s*True)/,
  },
  {
    severity: 'info', rule: 'Leftover debug / TODO',
    re: /\b(TODO|FIXME|XXX|console\.log\(|debugger;)\b/,
  },
];

const SCAN_EXT = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rb', '.php', '.java', '.env', '.yml', '.yaml', '.json', '.sql']);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'output', '.synapse', 'vendor', '__pycache__']);

function collectFiles(dir: string, depth: number, acc: string[]): void {
  if (depth > 6 || acc.length > 2000) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(full, depth + 1, acc);
    else {
      const ext = path.extname(e.name);
      if (SCAN_EXT.has(ext) || e.name.startsWith('.env')) acc.push(full);
    }
  }
}

export function scanSecurity(projectDir: string): Finding[] {
  const files: string[] = [];
  collectFiles(projectDir, 0, files);
  const findings: Finding[] = [];
  for (const file of files) {
    if (/\.example$|\.sample$/.test(file)) continue;
    let lines: string[];
    try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { continue; }
    if (lines.length > 5000) continue;
    lines.forEach((text, i) => {
      for (const r of RULES) {
        if (r.re.test(text) && !(r.ignore && r.ignore.test(text))) {
          findings.push({
            severity: r.severity,
            rule: r.rule,
            file: path.relative(projectDir, file),
            line: i + 1,
            excerpt: text.trim().slice(0, 100),
          });
        }
      }
    });
    if (findings.length > 200) break;
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
