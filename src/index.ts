import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { showBanner } from './ui/banner';
import { generateAnalysis, renderAnalysisTable, FALLBACK as FALLBACK_ANALYSIS } from './analyzer';
import { assignRolesFromAnalysis, assignRolesManually, assignRolesForTracks, getRoleReason } from './assigner';
import { decomposeToTracks } from './task-splitter';
import { runVisualOrchestration } from './visual-orchestrator';
import { tmuxAvailable } from './launcher';
import { pickComplexity, runComplexityQA, buildConstraintBlock } from './complexity';
import { detectDomain, domainSkills } from './domain-roles';
import { renderSkills } from './skills';
import { renderSoul } from './souls';
import { loadContext } from './memory';
import { validateIdea } from './validator';
import type { CLIId } from './types';

// ── Session cleanup ───────────────────────────────────────────────────────────
function cleanOldSessions(): void {
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) return;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (const entry of fs.readdirSync(outputDir)) {
      const full = path.join(outputDir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {}
}

function cliAvailable(bin: string): boolean {
  try { execSync(`which ${bin}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── Print helpers ─────────────────────────────────────────────────────────────
const T = '  ';  // indent
const dim  = (s: string) => chalk.dim(s);
const teal = (s: string) => chalk.hex('#00efd4')(s);
const ok   = (s: string) => chalk.green(`✓ ${s}`);
const sep  = () => console.log(dim(T + '─'.repeat(54)));
const kv   = (k: string, v: string, badge?: string) =>
  console.log(`${T}${dim(k.padEnd(14))}${chalk.bold(v)}${badge ? '  ' + badge : ''}`);

// ── Shell command approval ────────────────────────────────────────────────────
async function runWithApproval(cmd: string, cwd?: string): Promise<boolean> {
  const w = Math.min(Math.max(cmd.length + 6, 50), 74);
  console.log();
  console.log(dim(`${T}┌─ SHELL COMMAND ${'─'.repeat(w - 16)}┐`));
  console.log(`${T}│  ${chalk.white.bold(cmd.padEnd(w - 5))}│`);
  console.log(dim(`${T}└${'─'.repeat(w - 1)}┘`));

  const { action } = await inquirer.prompt<{ action: string }>([{
    type: 'expand', name: 'action',
    message: `${T}Run?`,
    default: 'y',
    choices: [
      { key: 'y', name: 'Yes — run it', value: 'yes'  },
      { key: 'n', name: 'No — skip',    value: 'no'   },
      { key: 'e', name: 'Edit command', value: 'edit'  },
    ],
  }]);

  let finalCmd = cmd;
  if (action === 'edit') {
    const { edited } = await inquirer.prompt<{ edited: string }>([{
      type: 'input', name: 'edited', message: `${T}Command:`, default: cmd,
    }]);
    finalCmd = edited.trim() || cmd;
  }
  if (action === 'no') { console.log(dim(`${T}Skipped.\n`)); return false; }

  try {
    execSync(finalCmd, { stdio: 'ignore', cwd });
    console.log(chalk.green(`${T}✓ Done\n`));
    return true;
  } catch (e: any) {
    console.log(chalk.red(`${T}✗ ${e.message}\n`));
    return false;
  }
}

// ── Project directory ─────────────────────────────────────────────────────────
async function resolveProjectDir(): Promise<string> {
  const { mode } = await inquirer.prompt<{ mode: string }>([{
    type: 'list', name: 'mode',
    message: 'Project directory:',
    choices: [
      { name: '◆  Create new folder on Desktop', value: 'new'      },
      { name: '◈  Use existing directory',        value: 'existing' },
    ],
  }]);

  if (mode === 'new') {
    const { name } = await inquirer.prompt<{ name: string }>([{
      type: 'input', name: 'name', message: 'Project name:',
      validate: (v: string) => v.trim().length > 0 || 'Cannot be empty',
    }]);
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const dir = path.join(os.homedir(), 'Desktop', slug);
    await runWithApproval(`mkdir -p '${dir}'`);
    fs.mkdirSync(dir, { recursive: true });
    await runWithApproval(`git init '${dir}'`);
    console.log(dim(`${T}Created: ${dir}\n`));
    return dir;
  }

  const { dir } = await inquirer.prompt<{ dir: string }>([{
    type: 'input', name: 'dir', message: 'Directory path:',
    default: process.cwd(),
    validate: (v: string) => fs.existsSync(v.trim()) || 'Directory does not exist',
  }]);
  return path.resolve(dir.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  cleanOldSessions();
  await showBanner();

  // ── Flags (override interactive toggles) ────────────────────────────────────
  const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));

  // ── Brief ─────────────────────────────────────────────────────────────────
  let brief = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();
  if (!brief) {
    const { b } = await inquirer.prompt<{ b: string }>([{
      type: 'input', name: 'b', message: 'Project brief:',
      validate: (v: string) => v.trim().length > 0 || 'Cannot be empty',
    }]);
    brief = b.trim();
  }
  console.log();

  // ── Exclusions ─────────────────────────────────────────────────────────────
  const { exclusions } = await inquirer.prompt<{ exclusions: string }>([{
    type: 'input', name: 'exclusions',
    message: dim('Anything to exclude?') + chalk.dim('  (e.g. no animations, no sound, keep it dead simple · Enter = nothing excluded)'),
  }]);
  if (exclusions.trim()) brief += `\n\nEXCLUSIONS: ${exclusions.trim()}`;
  console.log(dim(`${T}Brief refined with your preferences.\n`));

  // ── Complexity ─────────────────────────────────────────────────────────────
  const complexityProfile = await pickComplexity();
  console.log(dim(`${T}Stack: ${complexityProfile.techStack}\n`));

  const qaExtras = await runComplexityQA(complexityProfile);
  if (qaExtras) brief += qaExtras;
  console.log();

  // ── Domain detection ────────────────────────────────────────────────────────
  const domain = detectDomain(brief);
  if (domain.id !== 'generic') {
    kv('Domain', domain.label, teal('◇ specialized roles'));
    console.log();
  }

  // ── Pre-build idea validator ────────────────────────────────────────────────
  if (!flags.has('--no-validate')) {
    const vSpin = ora({ text: dim('Reality-checking the idea (GitHub · npm)...'), spinner: 'dots' }).start();
    const v = await validateIdea(brief);
    if (!v.ok) {
      vSpin.stop();
    } else {
      vSpin.succeed(chalk.green(`Reality signal: ${v.score}/100  ${dim(`(${v.verdict})`)}`));
      if (v.topRepos.length) {
        console.log(dim(`${T}Similar work already out there:`));
        for (const r of v.topRepos) {
          console.log(`${T}  ${teal('★ ' + r.stars.toLocaleString().padStart(7))}  ${chalk.bold(r.name)}`);
        }
      }
      if (v.npmPackages.length) console.log(dim(`${T}npm: ${v.npmPackages.join(', ')}`));
      console.log(dim(`${T}${v.suggestion}\n`));
      if (v.verdict === 'crowded') {
        const { proceed } = await inquirer.prompt<{ proceed: boolean }>([{
          type: 'confirm', name: 'proceed',
          message: `${T}This space is saturated — build anyway?`,
          default: true,
        }]);
        if (!proceed) { console.log(dim('\nAborted — refine the idea and try again.\n')); process.exit(0); }
      }
    }
    console.log();
  }

  // ── CLI selection ──────────────────────────────────────────────────────────
  const available = [
    { id: 'claude' as CLIId, label: 'Claude Code    (default: Architect)', installed: cliAvailable('claude') },
    { id: 'gemini' as CLIId, label: 'Gemini CLI     (default: Executor)',  installed: cliAvailable('gemini') },
    { id: 'codex'  as CLIId, label: 'Codex CLI      (Reviewer — needs OPENAI_API_KEY)', installed: cliAvailable('codex') },
  ];

  const { selectedIds } = await inquirer.prompt<{ selectedIds: CLIId[] }>([{
    type: 'checkbox', name: 'selectedIds',
    message: 'Select CLIs (min 2):',
    choices: available.map(c => ({
      name: c.installed ? c.label : `${c.label}  ${chalk.red('[not installed]')}`,
      value: c.id,
      checked: c.installed && (c.id === 'claude' || c.id === 'gemini'),
      disabled: !c.installed,
    })),
    validate: (v: CLIId[]) => v.length >= 2 || 'Select at least 2',
  }]);
  console.log();

  // ── Execution mode ─────────────────────────────────────────────────────────
  const { execMode } = await inquirer.prompt<{ execMode: string }>([{
    type: 'list', name: 'execMode',
    message: 'Execution mode:',
    choices: [
      {
        name: `Sequential Exchange   ${dim('Both build full project → exchange & review')}`,
        value: 'sequential',
      },
      {
        name: `${teal('Parallel Tracks')}       ${dim('Each CLI owns a domain → help each other → FASTER')}  ${chalk.hex('#ffdd00').bold('⚡ NEW')}`,
        value: 'parallel-tracks',
      },
    ],
  }]);
  console.log();

  // ── Advanced options (TDD / auto-review) ─────────────────────────────────────
  let tddMode = flags.has('--tdd');
  let reviewMode = flags.has('--review');
  if (!flags.has('--no-advanced')) {
    const { adv } = await inquirer.prompt<{ adv: string[] }>([{
      type: 'checkbox', name: 'adv',
      message: 'Advanced options:' + dim('  (space to toggle)'),
      choices: [
        { name: `TDD mode      ${dim('CLIs write tests first, then implementation')}`, value: 'tdd', checked: tddMode },
        { name: `Auto-review   ${dim('Phase 3: structured audit → REVIEW.md')}`, value: 'review', checked: reviewMode },
      ],
    }]);
    tddMode = adv.includes('tdd');
    reviewMode = adv.includes('review');
  }
  if (tddMode || reviewMode) {
    console.log(dim(`${T}Enabled: ${[tddMode && 'TDD', reviewMode && 'Auto-review'].filter(Boolean).join(', ')}`));
  }
  console.log();

  // ── Connection: always MCP ─────────────────────────────────────────────────
  const effectiveMethod = 'mcp';
  sep();
  kv('Connection', 'MCP  (Model Context Protocol)', teal('⬡ collaborative bridge'));
  sep();
  console.log();

  // ── Project directory ──────────────────────────────────────────────────────
  const projectDir = await resolveProjectDir();

  // ── Pre-flight: verify write access ───────────────────────────────────────
  const writeTest = path.join(projectDir, `.synapse-write-test-${Date.now()}`);
  try {
    fs.writeFileSync(writeTest, 'ok');
    fs.unlinkSync(writeTest);
  } catch {
    console.log(chalk.red(`\n${T}✗  Cannot write to ${projectDir}`));
    console.log(chalk.yellow(`${T}   This is a macOS permission issue — CLIs will fail to create files.`));
    console.log(dim(`${T}   Fix → System Preferences → Privacy & Security → Full Disk Access → enable Terminal`));
    console.log(dim(`${T}   Or pick a directory inside ~/Documents or ~/code instead of ~/Desktop\n`));
    const { cont } = await inquirer.prompt<{ cont: boolean }>([{
      type: 'confirm', name: 'cont',
      message: `${T}Continue anyway?`,
      default: false,
    }]);
    if (!cont) { console.log(dim('\nAborted.\n')); process.exit(0); }
  }
  console.log(chalk.green(`${T}✓ Write access confirmed\n`));

  // ── Connect spinner ────────────────────────────────────────────────────────
  const connectSpinner = ora({ text: dim('Wiring MCP bridge...'), spinner: 'dots' }).start();
  await new Promise(r => setTimeout(r, 500));
  connectSpinner.succeed(chalk.green(`Connected: ${selectedIds.join(', ')}`));

  // ── Role assignment ────────────────────────────────────────────────────────
  let activeCLIs;

  if (execMode === 'parallel-tracks') {
    const trackSpinner = ora({ text: dim('Decomposing project into parallel tracks...'), spinner: 'dots' }).start();
    const decomp = await decomposeToTracks(brief, complexityProfile);
    trackSpinner.succeed(chalk.green('Track decomposition complete'));

    console.log();
    sep();
    console.log(`${T}${teal('Track A')}  ${chalk.bold(decomp.trackA.label)}`);
    console.log(dim(`${T}         ${decomp.trackA.scope}`));
    console.log();
    console.log(`${T}${chalk.hex('#4285f4').bold('Track B')}  ${chalk.bold(decomp.trackB.label)}`);
    console.log(dim(`${T}         ${decomp.trackB.scope}`));
    console.log();
    console.log(dim(`${T}Shared interfaces: ${decomp.interfacesHint}`));
    sep();
    console.log();

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm', name: 'confirm',
      message: `Assign Track A → ${selectedIds[0]},  Track B → ${selectedIds[1]}?`,
      default: true,
    }]);

    if (confirm) {
      activeCLIs = assignRolesForTracks(selectedIds, decomp.trackA, decomp.trackB);
    } else {
      const { aId } = await inquirer.prompt<{ aId: CLIId }>([{
        type: 'list', name: 'aId',
        message: `Who builds Track A (${decomp.trackA.label})?`,
        choices: selectedIds,
      }]);
      const { bId } = await inquirer.prompt<{ bId: CLIId }>([{
        type: 'list', name: 'bId',
        message: `Who builds Track B (${decomp.trackB.label})?`,
        choices: selectedIds.filter(id => id !== aId),
      }]);
      const reordered = [aId, bId, ...selectedIds.filter(id => id !== aId && id !== bId)] as CLIId[];
      activeCLIs = assignRolesForTracks(reordered, decomp.trackA, decomp.trackB);
    }

  } else {
    const { roleMode } = await inquirer.prompt<{ roleMode: string }>([{
      type: 'list', name: 'roleMode',
      message: 'Role assignment:',
      choices: [
        {
          name: `${chalk.hex('#ffdd00').bold('⚡ Quick')}       ${dim('Claude → Architect  ·  Gemini → Executor  (instant)')}`,
          value: 'quick',
        },
        {
          name: `Auto-analyse   ${dim('Scores both CLIs then assigns roles  (~15s)')}`,
          value: 'auto',
        },
        {
          name: `Manual         ${dim('I pick who does what')}`,
          value: 'manual',
        },
      ],
    }]);

    let analysis = FALLBACK_ANALYSIS;
    if (roleMode === 'auto') {
      const analysisSpinner = ora({ text: dim('Analysing CLI capabilities...'), spinner: 'dots' }).start();
      analysis = await generateAnalysis(projectDir);
      analysisSpinner.succeed(chalk.green('Capability analysis complete'));
      console.log();
      renderAnalysisTable(analysis);
    } else if (roleMode === 'quick') {
      console.log(dim(`${T}Claude → Architect  ·  Gemini → Executor\n`));
    }

    if (roleMode === 'manual') {
      const { archId } = await inquirer.prompt<{ archId: CLIId }>([{
        type: 'list', name: 'archId', message: 'Who is the Architect?', choices: selectedIds,
      }]);
      const { execId } = await inquirer.prompt<{ execId: CLIId }>([{
        type: 'list', name: 'execId', message: 'Who is the Executor?',
        choices: selectedIds.filter(id => id !== archId),
      }]);
      activeCLIs = assignRolesManually(selectedIds, archId, execId);
    } else {
      activeCLIs = assignRolesFromAnalysis(analysis, selectedIds);
    }

    console.log();
    sep();
    for (const cli of activeCLIs.configs) {
      const icon = cli.role === 'architect' ? '◆' : cli.role === 'executor' ? '◈' : '◦';
      console.log(`${T}${teal(icon)}  ${chalk.bold(cli.name.padEnd(30))}${dim(cli.role.toUpperCase())}`);
    }
    console.log(dim(`\n${T}${getRoleReason(analysis)}`));
    sep();
    console.log();
  }

  // ── Inject soul · domain · constraints · memory · skills into each preamble ──
  const constraintBlock = buildConstraintBlock(complexityProfile);
  const memoryBlock = loadContext(projectDir);              // null on a fresh project
  const skillNames = domainSkills(domain, { tdd: tddMode }); // domain skills (+ tdd if on)
  const skillsBlock = renderSkills(skillNames, projectDir);
  if (memoryBlock) console.log(dim(`${T}Loaded prior project context from .synapse/CONTEXT.md`));
  if (skillNames.length) console.log(dim(`${T}Skills injected: ${skillNames.join(', ')}\n`));

  for (const cli of activeCLIs.configs) {
    const roleTitle = domain.roleTitles[cli.role];
    const domainNote = domain.id === 'generic'
      ? ''
      : `PROJECT DOMAIN: ${domain.label} — you are acting as the ${roleTitle}.`;
    cli.preamble = [
      renderSoul(cli.id),
      domainNote,
      constraintBlock,
      memoryBlock ?? '',
      skillsBlock,
      cli.preamble,
    ].filter(Boolean).join('\n\n');
    // Relabel display name with the domain-specific role title.
    cli.name = cli.name.replace(/\([^)]*\)\s*$/, `(${roleTitle})`);
  }

  // ── Mode info ──────────────────────────────────────────────────────────────
  if (!tmuxAvailable()) {
    console.log(chalk.yellow(`${T}⚠  tmux not found — install it for the visual dashboard\n`));
  } else {
    const modeLabel = execMode === 'parallel-tracks'
      ? teal('parallel tracks')
      : teal('sequential exchange');
    console.log(dim(`${T}Mode: `) + modeLabel + '\n');
  }

  // ── Safe mode ──────────────────────────────────────────────────────────────
  const { safeMode } = await inquirer.prompt<{ safeMode: boolean }>([{
    type: 'confirm', name: 'safeMode',
    message: 'Enable safe mode?' + dim('  (monitors for dangerous commands — slower)'),
    default: false,
  }]);

  // ── Launch ─────────────────────────────────────────────────────────────────
  const { go } = await inquirer.prompt<{ go: boolean }>([{
    type: 'confirm', name: 'go', message: 'Ready to build?', default: true,
  }]);
  if (!go) { console.log(dim('\nAborted.\n')); process.exit(0); }
  console.log();

  await runVisualOrchestration(brief, effectiveMethod, activeCLIs, projectDir, safeMode, {
    reviewMode,
    techStack: complexityProfile.techStack,
  });
}

main().catch(e => {
  console.error(chalk.red('\nError:'), e.message ?? e);
  process.exit(1);
});
