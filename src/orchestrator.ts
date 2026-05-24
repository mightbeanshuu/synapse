import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { runCLI } from './runner';
import { Bridge } from './bridge';
import { phase1Prompt, phase2Prompt } from './prompts';
import type { ActiveCLIs } from './types';

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Headless fallback (no tmux) — uses first two CLIs only
export async function runOrchestration(
  brief: string,
  connectionMethod: string,
  activeCLIs: ActiveCLIs,
  projectDir: string
): Promise<void> {
  const [arch, exec] = activeCLIs.configs;
  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionDir = path.join(__dirname, '..', 'output', `session-${timestamp}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const bridge = new Bridge(sessionDir);

  console.log(chalk.dim(`\nConnection : ${connectionMethod}`));
  console.log(chalk.dim(`Output     : ${sessionDir}\n`));

  console.log(chalk.bold.white('┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 1 — Parallel Build               │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const [r1, r2] = await Promise.all([
    runCLI(arch.binary, arch.name, phase1Prompt(arch.preamble, brief), projectDir),
    runCLI(exec.binary, exec.name, phase1Prompt(exec.preamble, brief), projectDir),
  ]);

  console.log(chalk.green(`\n✓ ${r1.cli} — ${sec(r1.durationMs)}`));
  console.log(chalk.green(`✓ ${r2.cli} — ${sec(r2.durationMs)}`));
  bridge.append(`Phase 1 — ${r1.cli}`, r1.output);
  bridge.append(`Phase 1 — ${r2.cli}`, r2.output);

  console.log(chalk.bold.white('\n┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 2 — Exchange & Fill Gaps         │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const [e1, e2] = await Promise.all([
    runCLI(arch.binary, arch.name, phase2Prompt(arch.preamble, brief, r2.cli, r2.output), projectDir),
    runCLI(exec.binary, exec.name, phase2Prompt(exec.preamble, brief, r1.cli, r1.output), projectDir),
  ]);

  console.log(chalk.green(`\n✓ ${e1.cli} exchange — ${sec(e1.durationMs)}`));
  console.log(chalk.green(`✓ ${e2.cli} exchange — ${sec(e2.durationMs)}`));
  bridge.append(`Phase 2 — ${e1.cli}`, e1.output);
  bridge.append(`Phase 2 — ${e2.cli}`, e2.output);

  const sessionFile = path.join(sessionDir, 'session.md');
  fs.writeFileSync(sessionFile, `# Synapse Session\n**Brief:** ${brief}\n**Project:** ${projectDir}\n\n${bridge.read()}`);
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          Session Complete                 ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝'));
  console.log(`\nSession: ${chalk.underline(sessionFile)}\n`);
}
