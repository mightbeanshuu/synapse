import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { Bridge } from './bridge';
import { launchVisual, relaunchPhase, waitForMarkers } from './launcher';
import type { AssignedRoles } from './types';

// Builds a prompt that instructs the CLI to actually create files on disk
function buildAgenticPrompt(
  preamble: string,
  brief: string,
  projectDir: string,
  bridgePath: string,
  doneMarker: string
): string {
  return `${preamble}

---
PROJECT BRIEF:
${brief}
---

WORKING DIRECTORY: ${projectDir}

CRITICAL RULES — YOU MUST FOLLOW THESE:
1. Use your tools to CREATE REAL FILES on disk. Do not just output code in text.
2. Set up the project properly: run npm init, npm install, create all directories.
3. Write complete, working code — not stubs or pseudocode.
4. After writing files, run the code to verify it compiles/works (tsc --noEmit, npm test, etc.).
5. When you are 100% done, run this EXACT bash command:
   echo "${doneMarker}" >> "${bridgePath}"

Start building now. Create real files. Run real commands. Do not stop until the project works.`;
}

function buildPhase2Prompt(
  preamble: string,
  brief: string,
  peerName: string,
  projectDir: string,
  bridgePath: string,
  doneMarker: string
): string {
  return `${preamble}

---
PROJECT BRIEF:
${brief}
---

WORKING DIRECTORY: ${projectDir}

You are in PHASE 2. ${peerName} already did Phase 1 work in the directory above.

YOUR PHASE 2 JOB:
1. Read ALL the files ${peerName} created (use your file reading tools to check the directory)
2. From YOUR role's perspective, find: missing files, broken logic, missing tests, poor structure, security issues
3. Fix and add what's missing — create real files using your tools
4. Run the full project and verify everything works end-to-end
5. When you are 100% done, run this EXACT bash command:
   echo "${doneMarker}" >> "${bridgePath}"

Review, fix, and improve. Make real changes to real files.`;
}

export async function runVisualOrchestration(
  brief: string,
  connectionMethod: string,
  roles: AssignedRoles,
  projectDir: string
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionDir = path.join(__dirname, '..', 'output', `session-${timestamp}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const bridge = new Bridge(sessionDir);

  console.log(chalk.dim(`  Connection : ${connectionMethod}`));
  console.log(chalk.dim(`  Project    : ${projectDir}`));
  console.log(chalk.dim(`  Output     : ${sessionDir}\n`));

  // ── Phase 1 ──────────────────────────────────────────────────────────────
  console.log(chalk.bold.white('┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 1 — Opening Visual Terminals     │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const claudeP1File = path.join(sessionDir, 'claude_p1.txt');
  const geminiP1File = path.join(sessionDir, 'gemini_p1.txt');

  fs.writeFileSync(claudeP1File, buildAgenticPrompt(
    roles.architect.preamble, brief, projectDir, bridge.path, 'CLAUDE_P1_DONE'
  ));
  fs.writeFileSync(geminiP1File, buildAgenticPrompt(
    roles.executor.preamble, brief, projectDir, bridge.path, 'GEMINI_P1_DONE'
  ));

  launchVisual({
    projectDir,
    claudePromptFile: claudeP1File,
    geminiPromptFile: geminiP1File,
    bridgePath: bridge.path,
    phase: 1,
    architectName: roles.architect.name,
    executorName: roles.executor.name,
  });

  console.log(chalk.cyan('  ⬡  Two terminal panes opened — Claude (left) + Gemini (right)'));
  console.log(chalk.dim('  Both CLIs are now building in parallel. Watch the new window.\n'));

  const p1Spinner = ora('Phase 1 building in visual terminals (timeout: 15 min)...').start();
  const p1Done = await waitForMarkers(bridge.path, ['CLAUDE_P1_DONE', 'GEMINI_P1_DONE'], 15 * 60 * 1000);

  if (p1Done) {
    p1Spinner.succeed(chalk.green('Phase 1 complete — both CLIs finished building'));
  } else {
    p1Spinner.warn(chalk.yellow('Phase 1 timed out — proceeding to Phase 2'));
  }

  // ── Phase 2 ──────────────────────────────────────────────────────────────
  console.log(chalk.bold.white('\n┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.white('│  PHASE 2 — Exchange & Review            │'));
  console.log(chalk.bold.white('└─────────────────────────────────────────┘\n'));

  const claudeP2File = path.join(sessionDir, 'claude_p2.txt');
  const geminiP2File = path.join(sessionDir, 'gemini_p2.txt');

  fs.writeFileSync(claudeP2File, buildPhase2Prompt(
    roles.architect.preamble, brief, roles.executor.name, projectDir, bridge.path, 'CLAUDE_P2_DONE'
  ));
  fs.writeFileSync(geminiP2File, buildPhase2Prompt(
    roles.executor.preamble, brief, roles.architect.name, projectDir, bridge.path, 'GEMINI_P2_DONE'
  ));

  relaunchPhase({
    projectDir,
    claudePromptFile: claudeP2File,
    geminiPromptFile: geminiP2File,
    bridgePath: bridge.path,
    phase: 2,
    architectName: roles.architect.name,
    executorName: roles.executor.name,
  });

  console.log(chalk.cyan('  ⬡  Phase 2 running — each CLI reviews the other\'s work\n'));

  const p2Spinner = ora('Phase 2 review & gap-fill (timeout: 10 min)...').start();
  const p2Done = await waitForMarkers(bridge.path, ['CLAUDE_P2_DONE', 'GEMINI_P2_DONE'], 10 * 60 * 1000);

  if (p2Done) {
    p2Spinner.succeed(chalk.green('Phase 2 complete'));
  } else {
    p2Spinner.warn(chalk.yellow('Phase 2 timed out'));
  }

  // ── Session summary ───────────────────────────────────────────────────────
  const sessionFile = path.join(sessionDir, 'session.md');
  fs.writeFileSync(sessionFile, [
    `# Synapse Session`,
    `**Brief:** ${brief}`,
    `**Timestamp:** ${timestamp}`,
    `**Connection:** ${connectionMethod}`,
    `**Project:** ${projectDir}`,
    `**Architect:** ${roles.architect.name}`,
    `**Executor:** ${roles.executor.name}`,
    ``,
    `## Bridge Log`,
    bridge.read(),
  ].join('\n'));

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          Session Complete                 ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝'));
  console.log(`\nProject built at : ${chalk.underline(projectDir)}`);
  console.log(`Session file     : ${chalk.underline(sessionFile)}`);
  console.log(`Bridge file      : ${chalk.underline(bridge.path)}\n`);
}
