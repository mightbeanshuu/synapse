import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { Bridge } from './bridge';
import { launchDashboard, relaunchPhase, waitForMarkers } from './launcher';
import type { CLIConfig, ActiveCLIs } from './types';

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildPhase1Prompt(cli: CLIConfig, brief: string, projectDir: string, bridgePath: string): string {
  const doneMarker = `${cli.id.toUpperCase()}_P1_DONE`;
  return `${cli.preamble}

---
PROJECT BRIEF:
${brief}
---

WORKING DIRECTORY: ${projectDir}

⚠ MANDATORY RULES — you MUST follow these or the session fails:
1. Use your tools to CREATE REAL FILES on disk. Do not output code as text blocks.
2. Run package manager commands: npm init, npm install, etc.
3. Write complete, working code — no stubs, no TODOs, no pseudocode.
4. After writing files, verify they compile/run: npx tsc --noEmit, npm test, etc.
5. When you are 100% done, run this EXACT bash command:
   echo "${doneMarker}" >> "${bridgePath}"

Work in: ${projectDir}
Start building now.`;
}

function buildPhase2Prompt(
  cli: CLIConfig,
  brief: string,
  projectDir: string,
  bridgePath: string,
  peerNames: string[],
  userGuidance: string
): string {
  const doneMarker = `${cli.id.toUpperCase()}_P2_DONE`;
  const guidanceBlock = userGuidance.trim()
    ? `\nUSER GUIDANCE FOR PHASE 2:\n${userGuidance}\n`
    : '';

  return `${cli.preamble}

---
PROJECT BRIEF:
${brief}
---

WORKING DIRECTORY: ${projectDir}
${guidanceBlock}
You are in PHASE 2. ${peerNames.join(', ')} already did Phase 1 work in the directory above.

PHASE 2 TASKS:
1. Read every file in ${projectDir} using your file reading tools
2. From YOUR role's perspective (${cli.role}), identify: missing files, bugs, security holes, missing tests, incomplete implementations
3. Fix and add what's missing — create real files, edit existing ones
4. Run the full project end-to-end and verify it works
5. When you are 100% done, run this EXACT bash command:
   echo "${doneMarker}" >> "${bridgePath}"

Start reviewing and improving now.`;
}

// ── Progress tracker ─────────────────────────────────────────────────────────

function progressLine(found: string[], total: string[], clis: CLIConfig[]): void {
  const parts = total.map(m => {
    const id = m.split('_')[0].toLowerCase();
    const cli = clis.find(c => c.id === id);
    const done = found.includes(m);
    return done
      ? chalk.green(`✓ ${cli?.name ?? id}`)
      : chalk.dim(`○ ${cli?.name ?? id}`);
  });
  process.stdout.write(`\r  ${parts.join('  ')}   `);
}

// ── Main visual orchestration ────────────────────────────────────────────────

export async function runVisualOrchestration(
  brief: string,
  connectionMethod: string,
  activeCLIs: ActiveCLIs,
  projectDir: string
): Promise<void> {
  const { configs: clis } = activeCLIs;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionDir = path.join(__dirname, '..', 'output', `session-${timestamp}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const bridge = new Bridge(sessionDir);

  console.log(chalk.dim(`  Connection : ${connectionMethod}`));
  console.log(chalk.dim(`  Project    : ${projectDir}`));
  console.log(chalk.dim(`  CLIs       : ${clis.map(c => c.name).join('  ·  ')}`));
  console.log(chalk.dim(`  Output     : ${sessionDir}\n`));

  // ── Phase 1 ──────────────────────────────────────────────────────────────
  console.log(chalk.bold.white('┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 1 — Parallel Build               │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const p1Files = clis.map((cli, i) => {
    const f = path.join(sessionDir, `${cli.id}_p1.txt`);
    fs.writeFileSync(f, buildPhase1Prompt(cli, brief, projectDir, bridge.path));
    return f;
  });

  launchDashboard({
    clis, promptFiles: p1Files, bridgePath: bridge.path,
    phase: 1, projectDir, sessionDir,
  });

  console.log(chalk.hex('#00efd4')('  ⬡  Dashboard opened → watch the new Terminal window\n'));

  const p1Markers = clis.map(c => `${c.id.toUpperCase()}_P1_DONE`);
  const p1Spinner = ora('Phase 1 building...').start();
  const p1Done = await waitForMarkers(
    bridge.path, p1Markers, 20 * 60 * 1000,
    (found, total) => { progressLine(found, total, clis); }
  );
  process.stdout.write('\n');

  p1Done
    ? p1Spinner.succeed(chalk.green('Phase 1 complete — all CLIs finished'))
    : p1Spinner.warn(chalk.yellow('Phase 1 timed out — proceeding'));

  // ── User guidance between phases ─────────────────────────────────────────
  console.log(chalk.dim('\n  Optional: add guidance for each CLI in Phase 2.\n'));

  const guidanceMap: Record<string, string> = {};
  for (const cli of clis) {
    const { g } = await inquirer.prompt<{ g: string }>([{
      type: 'input',
      name: 'g',
      message: `  ${chalk.hex(cli.color)(cli.name)} guidance (enter to skip):`,
    }]);
    if (g.trim()) guidanceMap[cli.id] = g.trim();
  }

  // ── Phase 2 ──────────────────────────────────────────────────────────────
  console.log(chalk.bold.white('\n┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 2 — Exchange & Review            │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const peerNames = (cli: CLIConfig) => clis.filter(c => c.id !== cli.id).map(c => c.name);

  const p2Files = clis.map(cli => {
    const f = path.join(sessionDir, `${cli.id}_p2.txt`);
    fs.writeFileSync(f, buildPhase2Prompt(
      cli, brief, projectDir, bridge.path,
      peerNames(cli), guidanceMap[cli.id] ?? ''
    ));
    return f;
  });

  relaunchPhase({
    clis, promptFiles: p2Files, bridgePath: bridge.path,
    phase: 2, projectDir, sessionDir,
  });

  const p2Markers = clis.map(c => `${c.id.toUpperCase()}_P2_DONE`);
  const p2Spinner = ora('Phase 2 review & gap-fill...').start();
  const p2Done = await waitForMarkers(
    bridge.path, p2Markers, 15 * 60 * 1000,
    (found, total) => { progressLine(found, total, clis); }
  );
  process.stdout.write('\n');

  p2Done
    ? p2Spinner.succeed(chalk.green('Phase 2 complete'))
    : p2Spinner.warn(chalk.yellow('Phase 2 timed out'));

  // ── Session summary ───────────────────────────────────────────────────────
  const sessionFile = path.join(sessionDir, 'session.md');
  fs.writeFileSync(sessionFile, [
    `# Synapse Session`,
    `**Brief:** ${brief}`,
    `**Timestamp:** ${timestamp}`,
    `**Connection:** ${connectionMethod}`,
    `**Project:** ${projectDir}`,
    `**CLIs:** ${clis.map(c => `${c.name} (${c.role})`).join(', ')}`,
    '', '---', '',
    `## Bridge Log`, bridge.read(),
  ].join('\n'));

  console.log(chalk.bold.hex('#00efd4')('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.hex('#00efd4')('║          Session Complete                 ║'));
  console.log(chalk.bold.hex('#00efd4')('╚══════════════════════════════════════════╝'));
  console.log(`\nProject built at : ${chalk.underline(projectDir)}`);
  console.log(`Session log      : ${chalk.underline(sessionFile)}`);
  console.log(`Bridge file      : ${chalk.underline(bridge.path)}\n`);
}
