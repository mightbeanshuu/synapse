import fs from 'fs';
import path from 'path';
import { runCLI } from './runner';
import { Bridge } from './bridge';
import { phase1Prompt, phase2Prompt } from './prompts';
import type { RolesConfig } from './types';

function loadRoles(): RolesConfig {
  const rolesPath = path.join(__dirname, '..', 'roles.json');
  return JSON.parse(fs.readFileSync(rolesPath, 'utf8')) as RolesConfig;
}

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage: npx tsx src/orchestrator.ts "<project brief>" [--dir <project-dir>]');
    console.log('');
    console.log('  <project brief>   What to build (required)');
    console.log('  --dir <path>      Working directory for both CLIs (default: current dir)');
    process.exit(args.length === 0 ? 1 : 0);
  }

  // Parse --dir flag
  let projectDir = process.cwd();
  const dirIdx = args.indexOf('--dir');
  if (dirIdx !== -1 && args[dirIdx + 1]) {
    projectDir = path.resolve(args[dirIdx + 1]);
    args.splice(dirIdx, 2);
  }

  const brief = args.join(' ').trim();
  const roles = loadRoles();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionDir = path.join(__dirname, '..', 'output', `session-${timestamp}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const bridge = new Bridge(sessionDir);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║          CLI Duo Orchestrator             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nBrief    : ${brief}`);
  console.log(`CLI 1    : ${roles.cli1.name} (${roles.cli1.binary})`);
  console.log(`CLI 2    : ${roles.cli2.name} (${roles.cli2.binary})`);
  console.log(`Mode     : Parallel → Exchange`);
  console.log(`Output   : ${sessionDir}`);
  console.log(`Project  : ${projectDir}`);

  // ── Phase 1: Both CLIs run in parallel ──────────────────────────────────
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  PHASE 1 — Parallel Build               │');
  console.log('└─────────────────────────────────────────┘\n');

  const [r1, r2] = await Promise.all([
    runCLI(roles.cli1.binary, roles.cli1.name, phase1Prompt(roles.cli1.preamble, brief), projectDir),
    runCLI(roles.cli2.binary, roles.cli2.name, phase1Prompt(roles.cli2.preamble, brief), projectDir),
  ]);

  console.log(`\n✓ ${r1.cli} — ${sec(r1.durationMs)}`);
  if (r1.error) console.log(`  ⚠ stderr: ${r1.error.slice(0, 120)}`);
  console.log(`✓ ${r2.cli} — ${sec(r2.durationMs)}`);
  if (r2.error) console.log(`  ⚠ stderr: ${r2.error.slice(0, 120)}`);

  bridge.append(`Phase 1 — ${r1.cli}`, r1.output);
  bridge.append(`Phase 1 — ${r2.cli}`, r2.output);

  // ── Phase 2: Each CLI reviews the other's output ─────────────────────────
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  PHASE 2 — Exchange & Fill Gaps         │');
  console.log('└─────────────────────────────────────────┘\n');

  const [e1, e2] = await Promise.all([
    runCLI(
      roles.cli1.binary,
      roles.cli1.name,
      phase2Prompt(roles.cli1.preamble, brief, r2.cli, r2.output),
      projectDir
    ),
    runCLI(
      roles.cli2.binary,
      roles.cli2.name,
      phase2Prompt(roles.cli2.preamble, brief, r1.cli, r1.output),
      projectDir
    ),
  ]);

  console.log(`\n✓ ${e1.cli} exchange — ${sec(e1.durationMs)}`);
  if (e1.error) console.log(`  ⚠ stderr: ${e1.error.slice(0, 120)}`);
  console.log(`✓ ${e2.cli} exchange — ${sec(e2.durationMs)}`);
  if (e2.error) console.log(`  ⚠ stderr: ${e2.error.slice(0, 120)}`);

  bridge.append(`Phase 2 — ${e1.cli} (reviewing ${r2.cli})`, e1.output);
  bridge.append(`Phase 2 — ${e2.cli} (reviewing ${r1.cli})`, e2.output);

  // ── Write session summary ────────────────────────────────────────────────
  const sessionMd = [
    `# CLI Duo Session`,
    `**Brief:** ${brief}`,
    `**Timestamp:** ${timestamp}`,
    `**Project Dir:** ${projectDir}`,
    `**Bridge:** ${bridge.path}`,
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

  const totalMs = r1.durationMs + r2.durationMs + e1.durationMs + e2.durationMs;
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              Session Complete             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nTotal wall-clock time : ~${sec(Math.max(r1.durationMs, r2.durationMs) + Math.max(e1.durationMs, e2.durationMs))}`);
  console.log(`Session file          : ${sessionFile}`);
  console.log(`Bridge file           : ${bridge.path}\n`);
}

main().catch((e) => {
  console.error('\nOrchestrator error:', e);
  process.exit(1);
});
