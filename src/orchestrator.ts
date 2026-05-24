import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { runCLI } from './runner';
import { Bridge } from './bridge';
import { phase1Prompt, phase2Prompt } from './prompts';
import type { AssignedRoles } from './types';

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function runOrchestration(
  brief: string,
  connectionMethod: string,
  roles: AssignedRoles,
  projectDir: string
): Promise<void> {
  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionDir = path.join(__dirname, '..', 'output', `session-${timestamp}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const bridge = new Bridge(sessionDir);

  console.log(chalk.dim(`\nConnection : ${connectionMethod}`));
  console.log(chalk.dim(`Output     : ${sessionDir}\n`));

  // ── Phase 1: Both CLIs run in parallel ──────────────────────────────────
  console.log(chalk.bold.white('┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 1 — Parallel Build               │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const [r1, r2] = await Promise.all([
    runCLI(roles.architect.binary, roles.architect.name, phase1Prompt(roles.architect.preamble, brief), projectDir),
    runCLI(roles.executor.binary,  roles.executor.name,  phase1Prompt(roles.executor.preamble,  brief), projectDir),
  ]);

  console.log(chalk.green(`\n✓ ${r1.cli} — ${sec(r1.durationMs)}`));
  if (r1.error) console.log(chalk.yellow(`  ⚠ ${r1.error.slice(0, 120)}`));
  console.log(chalk.green(`✓ ${r2.cli} — ${sec(r2.durationMs)}`));
  if (r2.error) console.log(chalk.yellow(`  ⚠ ${r2.error.slice(0, 120)}`));

  bridge.append(`Phase 1 — ${r1.cli}`, r1.output);
  bridge.append(`Phase 1 — ${r2.cli}`, r2.output);

  // ── Phase 2: Each CLI reviews the other's output ─────────────────────────
  console.log(chalk.bold.white('\n┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 2 — Exchange & Fill Gaps         │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const [e1, e2] = await Promise.all([
    runCLI(roles.architect.binary, roles.architect.name, phase2Prompt(roles.architect.preamble, brief, r2.cli, r2.output), projectDir),
    runCLI(roles.executor.binary,  roles.executor.name,  phase2Prompt(roles.executor.preamble,  brief, r1.cli, r1.output), projectDir),
  ]);

  console.log(chalk.green(`\n✓ ${e1.cli} exchange — ${sec(e1.durationMs)}`));
  if (e1.error) console.log(chalk.yellow(`  ⚠ ${e1.error.slice(0, 120)}`));
  console.log(chalk.green(`✓ ${e2.cli} exchange — ${sec(e2.durationMs)}`));
  if (e2.error) console.log(chalk.yellow(`  ⚠ ${e2.error.slice(0, 120)}`));

  bridge.append(`Phase 2 — ${e1.cli} (reviewing ${r2.cli})`, e1.output);
  bridge.append(`Phase 2 — ${e2.cli} (reviewing ${r1.cli})`, e2.output);

  // ── Write session summary ────────────────────────────────────────────────
  const sessionMd = [
    `# Synapse Session`,
    `**Brief:** ${brief}`,
    `**Timestamp:** ${timestamp}`,
    `**Connection:** ${connectionMethod}`,
    `**Project Dir:** ${projectDir}`,
    `**Architect:** ${roles.architect.name}`,
    `**Executor:** ${roles.executor.name}`,
    `**Role rationale:** ${roles.reason}`,
    ``,
    `---`,
    ``,
    `## Phase 1 — ${r1.cli}`,
    r1.output,
    ``,
    `---`,
    ``,
    `## Phase 1 — ${r2.cli}`,
    r2.output,
    ``,
    `---`,
    ``,
    `## Phase 2 — ${e1.cli} (after reviewing ${r2.cli})`,
    e1.output,
    ``,
    `---`,
    ``,
    `## Phase 2 — ${e2.cli} (after reviewing ${r1.cli})`,
    e2.output,
  ].join('\n');

  const sessionFile = path.join(sessionDir, 'session.md');
  fs.writeFileSync(sessionFile, sessionMd);

  const wallClock = Math.max(r1.durationMs, r2.durationMs) + Math.max(e1.durationMs, e2.durationMs);

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          Session Complete                 ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝'));
  console.log(`\nWall-clock time : ${sec(wallClock)}`);
  console.log(`Session file    : ${chalk.underline(sessionFile)}`);
  console.log(`Bridge file     : ${chalk.underline(bridge.path)}\n`);
}
