import Table from 'cli-table3';
import chalk from 'chalk';
import { runCLI } from './runner';
import type { Analysis, Score } from './types';

const ANALYSIS_PROMPT = `You are a neutral technical analyst comparing two AI CLI tools: Claude Code (Anthropic) and Gemini CLI (Google).

Score each on these 10 dimensions using a 1-10 scale based on their documented capabilities:

Output EXACTLY in this format — no intro text, no markdown fences, nothing before the table:

| Dimension | Claude | Gemini | Advantage |
|-----------|--------|--------|-----------|
| Code Architecture & Design | X | X | Claude/Gemini/Tie |
| Core Logic & Algorithms | X | X | Claude/Gemini/Tie |
| Edge Case Identification | X | X | Claude/Gemini/Tie |
| Code Generation Speed | X | X | Claude/Gemini/Tie |
| Boilerplate & File Setup | X | X | Claude/Gemini/Tie |
| Test Writing | X | X | Claude/Gemini/Tie |
| Debugging & Root Cause | X | X | Claude/Gemini/Tie |
| Documentation | X | X | Claude/Gemini/Tie |
| Tool & Command Execution | X | X | Claude/Gemini/Tie |
| Creative Problem Solving | X | X | Claude/Gemini/Tie |

ARCHITECT: claude
EXECUTOR: gemini
REASON: one sentence

Replace every X with a number 1-10. Be honest and balanced.`;

export const FALLBACK: Analysis = {
  scores: [
    { dimension: 'Code Architecture & Design', claude: 9, gemini: 7, advantage: 'Claude' },
    { dimension: 'Core Logic & Algorithms',    claude: 9, gemini: 7, advantage: 'Claude' },
    { dimension: 'Edge Case Identification',   claude: 9, gemini: 6, advantage: 'Claude' },
    { dimension: 'Code Generation Speed',      claude: 7, gemini: 9, advantage: 'Gemini' },
    { dimension: 'Boilerplate & File Setup',   claude: 7, gemini: 9, advantage: 'Gemini' },
    { dimension: 'Test Writing',               claude: 7, gemini: 8, advantage: 'Gemini' },
    { dimension: 'Debugging & Root Cause',     claude: 9, gemini: 7, advantage: 'Claude' },
    { dimension: 'Documentation',              claude: 8, gemini: 8, advantage: 'Tie'    },
    { dimension: 'Tool & Command Execution',   claude: 7, gemini: 9, advantage: 'Gemini' },
    { dimension: 'Creative Problem Solving',   claude: 9, gemini: 7, advantage: 'Claude' },
  ],
  architect: 'claude',
  executor: 'gemini',
  reason: 'Claude excels at deep reasoning and architecture; Gemini at rapid code generation and tool execution.',
};

function parseAnalysis(output: string): Analysis | null {
  const scores: Score[] = [];

  for (const line of output.split('\n')) {
    const m = line.match(/\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/);
    if (m && !m[1].toLowerCase().includes('dimension')) {
      scores.push({
        dimension: m[1].trim(),
        claude: parseInt(m[2], 10),
        gemini: parseInt(m[3], 10),
        advantage: m[4].trim(),
      });
    }
  }

  if (scores.length < 5) return null;

  const archM  = output.match(/ARCHITECT:\s*(claude|gemini)/i);
  const execM  = output.match(/EXECUTOR:\s*(claude|gemini)/i);
  const rsM    = output.match(/REASON:\s*(.+)/i);

  return {
    scores,
    architect: (archM?.[1]?.toLowerCase() ?? 'claude') as 'claude' | 'gemini',
    executor:  (execM?.[1]?.toLowerCase() ?? 'gemini') as 'claude' | 'gemini',
    reason: rsM?.[1]?.trim() ?? FALLBACK.reason,
  };
}

export async function generateAnalysis(projectDir: string): Promise<Analysis> {
  const result = await runCLI('claude', 'Claude (Analyst)', ANALYSIS_PROMPT, projectDir);
  return parseAnalysis(result.output) ?? FALLBACK;
}

export function renderAnalysisTable(analysis: Analysis): void {
  const table = new Table({
    head: [
      chalk.white('Dimension'),
      chalk.cyan('Claude'),
      chalk.yellow('Gemini'),
      chalk.green('Advantage'),
    ],
    colWidths: [34, 10, 10, 12],
    style: { head: [], border: ['gray'] },
  });

  for (const s of analysis.scores) {
    const claudeCell = chalk.cyan(`${s.claude}/10`);
    const geminiCell = chalk.yellow(`${s.gemini}/10`);
    const adv =
      s.advantage === 'Claude' ? chalk.cyan('Claude') :
      s.advantage === 'Gemini' ? chalk.yellow('Gemini') :
      chalk.gray('Tie');
    table.push([s.dimension, claudeCell, geminiCell, adv]);
  }

  console.log(table.toString());
}
