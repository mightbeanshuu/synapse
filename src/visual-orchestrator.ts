import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Bridge } from './bridge';
import { launchDashboard, writePhaseScripts, attachToCurrentTerminal, cleanupSession } from './launcher';
import { scanSecurity } from './security-scan';
import { saveContext, listProjectFiles } from './memory';
import type { CLIConfig, ActiveCLIs } from './types';

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildPhase1Prompt(cli: CLIConfig, brief: string, projectDir: string, _bridgePath: string): string {
  return `${cli.preamble}

---
PROJECT BRIEF:
${brief}
---

WORKING DIRECTORY: ${projectDir}

⚠ MANDATORY RULES:
1. CREATE REAL FILES on disk using your file tools — no code blocks in chat.
2. Run package manager commands (npm init, npm install, etc.).
3. Write COMPLETE, working code — no stubs, no TODOs.
4. Verify with: npx tsc --noEmit, npm test, etc.
5. When 100% done, call the MCP tool: signal_done(phase=1, summary="one sentence of what you built")
   Do NOT run any echo or shell command to signal completion — use the MCP tool only.

Work in: ${projectDir}
Start now.`;
}

function buildPhase2Prompt(
  cli: CLIConfig,
  brief: string,
  projectDir: string,
  bridgePath: string,
  peerNames: string[]
): string {
  const doneMarker = `${cli.id.toUpperCase()}_P2_DONE`;
  return `${cli.preamble}

---
PROJECT BRIEF:
${brief}
---

WORKING DIRECTORY: ${projectDir}

You are in PHASE 2. ${peerNames.join(', ')} completed Phase 1 work in the directory above.

PHASE 2 TASKS:
1. Read EVERY file in ${projectDir} using your file tools.
2. From YOUR role's perspective (${cli.role}), identify: missing files, bugs, security holes, missing tests.
3. Fix and ADD what's missing — create real files, edit existing ones.
4. Run the full project end-to-end and verify it works.
5. When 100% done, call the MCP tool: signal_done(phase=2, summary="one sentence of what you reviewed/fixed")
   Do NOT run any echo or shell command to signal completion — use the MCP tool only.

Start reviewing and improving now.`;
}

// ── Main visual orchestration ────────────────────────────────────────────────

export interface OrchestrationOpts {
  reviewMode?: boolean;
  techStack?: string;
}

export async function runVisualOrchestration(
  brief: string,
  connectionMethod: string,
  activeCLIs: ActiveCLIs,
  projectDir: string,
  safeMode = false,
  extra: OrchestrationOpts = {}
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

  const peerNames = (cli: CLIConfig) => clis.filter(c => c.id !== cli.id).map(c => c.name);

  // ── Pre-generate ALL prompt files (P1 and P2) before launching tmux ─────────
  const p1Files = clis.map(cli => {
    const f = path.join(sessionDir, `${cli.id}_p1.txt`);
    fs.writeFileSync(f, buildPhase1Prompt(cli, brief, projectDir, bridge.path));
    return f;
  });

  const p2Files = clis.map(cli => {
    const f = path.join(sessionDir, `${cli.id}_p2.txt`);
    fs.writeFileSync(f, buildPhase2Prompt(cli, brief, projectDir, bridge.path, peerNames(cli)));
    return f;
  });

  const opts = { clis, promptFiles: p1Files, bridgePath: bridge.path, projectDir, sessionDir, sessionId: timestamp, safeMode, reviewMode: extra.reviewMode };

  // Pre-write P2 run scripts (phase-manager.sh will execute them after guidance)
  writePhaseScripts(opts, 2, p2Files);

  // ── Launch dashboard (phase-manager.sh controls everything from here) ─────────
  launchDashboard(opts);

  console.log(chalk.hex('#00efd4')('  ⬡  Dashboard launching in this terminal...\n'));
  console.log(chalk.dim('  (Phase-manager handles phase transitions — detach with Ctrl+B D)\n'));

  // Attach tmux to current terminal — blocks until phase-manager detaches
  attachToCurrentTerminal();

  // Clean up MCP registrations
  cleanupSession({ sessionId: timestamp, projectDir, clis });

  // ── Resumed after detach ──────────────────────────────────────────────────────
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

  // ── Post-build security scan ────────────────────────────────────────────────
  const findings = scanSecurity(projectDir);
  if (findings.length > 0) {
    const crit = findings.filter(f => f.severity === 'critical');
    const warn = findings.filter(f => f.severity === 'warning');
    console.log(chalk.bold.hex('#ffae00')('\n  ⚠  Security scan'));
    console.log(chalk.dim(`     ${crit.length} critical · ${warn.length} warning · ${findings.length - crit.length - warn.length} info`));
    for (const f of findings.slice(0, 8)) {
      const c = f.severity === 'critical' ? chalk.red : f.severity === 'warning' ? chalk.yellow : chalk.dim;
      console.log(c(`     ${f.severity.toUpperCase().padEnd(8)} ${f.rule}  —  ${f.file}:${f.line}`));
    }
    if (findings.length > 8) console.log(chalk.dim(`     …and ${findings.length - 8} more`));
  } else {
    console.log(chalk.green('\n  ✓  Security scan: no obvious issues'));
  }

  // ── Persist session memory for the next run in this directory ────────────────
  saveContext(projectDir, {
    brief,
    techStack: extra.techStack ?? 'unspecified',
    clis: clis.map(c => `${c.name} (${c.role})`).join(', '),
    files: listProjectFiles(projectDir),
  });
  console.log(chalk.dim('  ✓  Saved project context → .synapse/CONTEXT.md'));

  console.log(chalk.bold.hex('#00efd4')('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.hex('#00efd4')('║          Session Complete                 ║'));
  console.log(chalk.bold.hex('#00efd4')('╚══════════════════════════════════════════╝'));
  console.log(`\nProject built at : ${chalk.underline(projectDir)}`);
  console.log(`Session log      : ${chalk.underline(sessionFile)}`);
  console.log(`Bridge file      : ${chalk.underline(bridge.path)}\n`);
}
