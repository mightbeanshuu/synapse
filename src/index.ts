import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { showBanner } from './ui/banner';
import { CONNECTION_METHODS, pickFastest } from './connect/methods';
import { generateAnalysis, renderAnalysisTable } from './analyzer';
import { assignRolesFromAnalysis, assignRolesManually, assignRolesForTracks, getRoleReason } from './assigner';
import { decomposeToTracks } from './task-splitter';
import { runVisualOrchestration } from './visual-orchestrator';
import { tmuxAvailable } from './launcher';
import type { CLIId } from './types';

// ── CLI availability ──────────────────────────────────────────────────────────
function cliAvailable(bin: string): boolean {
  try { execSync(`which ${bin}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── Bash command approval UI ──────────────────────────────────────────────────
async function runWithApproval(cmd: string, cwd?: string): Promise<boolean> {
  const boxW = Math.min(Math.max(cmd.length + 4, 52), 72);
  const inner = cmd.padEnd(boxW - 4);
  console.log();
  console.log(chalk.dim('  ╔══ SHELL COMMAND ') + chalk.dim('═'.repeat(boxW - 18)) + chalk.dim('╗'));
  console.log(`  ║  ${chalk.bold.white(inner)}  ` + chalk.dim('║'));
  console.log(chalk.dim('  ╚') + chalk.dim('═'.repeat(boxW)) + chalk.dim('╝'));

  const { action } = await inquirer.prompt<{ action: string }>([{
    type: 'expand', name: 'action',
    message: chalk.white('  Run?'),
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
      type: 'input', name: 'edited',
      message: chalk.white('  Command:'),
      default: cmd,
    }]);
    finalCmd = edited.trim() || cmd;
  }
  if (action === 'no') { console.log(chalk.dim('  Skipped.\n')); return false; }

  try {
    execSync(finalCmd, { stdio: 'ignore', cwd });
    console.log(chalk.green('  ✓ Done\n'));
    return true;
  } catch (e: any) {
    console.log(chalk.red(`  ✗ ${e.message}\n`));
    return false;
  }
}

// ── Project directory ─────────────────────────────────────────────────────────
async function resolveProjectDir(): Promise<string> {
  const { mode } = await inquirer.prompt<{ mode: string }>([{
    type: 'list', name: 'mode',
    message: chalk.white('Project directory:'),
    choices: [
      { name: '✦  Create new folder on Desktop', value: 'new'      },
      { name: '📁  Use existing directory',       value: 'existing' },
    ],
  }]);

  if (mode === 'new') {
    const { name } = await inquirer.prompt<{ name: string }>([{
      type: 'input', name: 'name',
      message: chalk.white('Project name:'),
      validate: (v: string) => v.trim().length > 0 || 'Cannot be empty',
    }]);
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const dir = path.join(os.homedir(), 'Desktop', slug);
    await runWithApproval(`mkdir -p '${dir}'`);
    fs.mkdirSync(dir, { recursive: true });
    await runWithApproval(`git init '${dir}'`);
    console.log(chalk.dim(`  Created: ${dir}\n`));
    return dir;
  }

  const { dir } = await inquirer.prompt<{ dir: string }>([{
    type: 'input', name: 'dir',
    message: chalk.white('Directory path:'),
    default: process.cwd(),
    validate: (v: string) => fs.existsSync(v.trim()) || 'Directory does not exist',
  }]);
  return path.resolve(dir.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await showBanner();

  // ── Brief ──────────────────────────────────────────────────────────────────
  let brief = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();
  if (!brief) {
    const { b } = await inquirer.prompt<{ b: string }>([{
      type: 'input', name: 'b',
      message: chalk.white('Project brief:'),
      validate: (v: string) => v.trim().length > 0 || 'Cannot be empty',
    }]);
    brief = b.trim();
  }
  console.log();

  // ── CLI selection ──────────────────────────────────────────────────────────
  const available = [
    { id: 'claude' as CLIId, label: 'Claude Code    (default: Architect)', installed: cliAvailable('claude') },
    { id: 'gemini' as CLIId, label: 'Gemini CLI     (default: Executor)',  installed: cliAvailable('gemini') },
    { id: 'codex'  as CLIId, label: 'Codex CLI      (Reviewer — needs OPENAI_API_KEY)', installed: cliAvailable('codex') },
  ];

  const { selectedIds } = await inquirer.prompt<{ selectedIds: CLIId[] }>([{
    type: 'checkbox', name: 'selectedIds',
    message: chalk.white('Select CLIs (min 2):'),
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
    message: chalk.white('Execution mode:'),
    choices: [
      {
        name: `${chalk.bold('Sequential Exchange')}   ${chalk.dim('Both build the full project → exchange & review')}`,
        value: 'sequential',
      },
      {
        name: `${chalk.hex('#00efd4').bold('Parallel Tracks')}      ${chalk.dim('Each CLI owns a domain → they help each other → FASTER')}  ${chalk.hex('#ffdd00').bold('⚡ NEW')}`,
        value: 'parallel-tracks',
      },
    ],
  }]);
  console.log();

  // ── Connection method ──────────────────────────────────────────────────────
  const { methodIds } = await inquirer.prompt<{ methodIds: string[] }>([{
    type: 'checkbox', name: 'methodIds',
    message: chalk.white('Connection methods (fastest available wins):'),
    choices: CONNECTION_METHODS.map(m => {
      const bar = m.speedBar ? chalk.hex('#00efd4')(m.speedBar) + '  ' + chalk.bold(m.speedLabel ?? '') : '';
      const badge = m.badge ? chalk.hex('#ffdd00').bold(`  ${m.badge}`) : '';
      return {
        name: `${m.icon}  ${chalk.bold(m.name.padEnd(22))}${bar}${badge}${!m.implemented ? chalk.red('  [soon]') : ''}`,
        value: m.id,
        checked: m.id === 'named-pipe',
        disabled: !m.implemented,
      };
    }),
    validate: (v: string[]) => v.length >= 1 || 'Select at least one',
  }]);

  const effectiveMethod = pickFastest(methodIds);
  const methodName = CONNECTION_METHODS.find(m => m.id === effectiveMethod)?.name ?? effectiveMethod;
  console.log(chalk.dim(`\n  Using: ${chalk.bold(methodName)}\n`));

  // ── Project directory ──────────────────────────────────────────────────────
  const projectDir = await resolveProjectDir();

  // ── Connect ────────────────────────────────────────────────────────────────
  const connectSpinner = ora('Connecting to CLIs...').start();
  await new Promise(r => setTimeout(r, 400));
  connectSpinner.succeed(chalk.green(`Connected: ${selectedIds.join(', ')}`));

  // ── Role assignment ────────────────────────────────────────────────────────
  let activeCLIs;

  if (execMode === 'parallel-tracks') {
    // Parallel tracks: decompose brief, assign track preambles
    const trackSpinner = ora('Decomposing project into parallel tracks...').start();
    const decomp = await decomposeToTracks(brief);
    trackSpinner.succeed(chalk.green('Track decomposition complete'));

    console.log('\n' + chalk.bold('  Parallel Track Assignment\n'));
    console.log(`  ${chalk.hex('#00efd4').bold('Track A')}  ${chalk.bold(decomp.trackA.label)}`);
    console.log(chalk.dim(`          ${decomp.trackA.scope}\n`));
    console.log(`  ${chalk.hex('#4285f4').bold('Track B')}  ${chalk.bold(decomp.trackB.label)}`);
    console.log(chalk.dim(`          ${decomp.trackB.scope}\n`));
    console.log(chalk.dim(`  Shared interfaces: ${decomp.interfacesHint}\n`));

    // Let user confirm or reassign tracks to CLIs
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm', name: 'confirm',
      message: chalk.white(`  Assign Track A → ${selectedIds[0]},  Track B → ${selectedIds[1]}?`),
      default: true,
    }]);

    if (confirm) {
      activeCLIs = assignRolesForTracks(selectedIds, decomp.trackA, decomp.trackB);
    } else {
      const { aId } = await inquirer.prompt<{ aId: CLIId }>([{
        type: 'list', name: 'aId',
        message: chalk.white(`  Who builds Track A (${decomp.trackA.label})?`),
        choices: selectedIds,
      }]);
      const { bId } = await inquirer.prompt<{ bId: CLIId }>([{
        type: 'list', name: 'bId',
        message: chalk.white(`  Who builds Track B (${decomp.trackB.label})?`),
        choices: selectedIds.filter(id => id !== aId),
      }]);
      const reordered = [aId, bId, ...selectedIds.filter(id => id !== aId && id !== bId)] as CLIId[];
      activeCLIs = assignRolesForTracks(reordered, decomp.trackA, decomp.trackB);
    }

  } else {
    // Sequential: capability analysis + optional manual override
    const analysisSpinner = ora('Analysing CLI capabilities (~15s)...').start();
    const analysis = await generateAnalysis(projectDir);
    analysisSpinner.succeed(chalk.green('Capability analysis complete'));

    console.log('\n' + chalk.bold('  Capability Comparison\n'));
    renderAnalysisTable(analysis);

    // Ask: auto or manual role assignment?
    const { roleMode } = await inquirer.prompt<{ roleMode: string }>([{
      type: 'list', name: 'roleMode',
      message: chalk.white('\n  Role assignment:'),
      choices: [
        { name: `Auto  ${chalk.dim(`(${analysis.architect} → Architect, ${analysis.executor} → Executor)`)}`, value: 'auto' },
        { name: 'Manual — I pick who does what', value: 'manual' },
      ],
    }]);

    if (roleMode === 'manual') {
      const { archId } = await inquirer.prompt<{ archId: CLIId }>([{
        type: 'list', name: 'archId',
        message: chalk.white('  Who is the Architect?'),
        choices: selectedIds,
      }]);
      const { execId } = await inquirer.prompt<{ execId: CLIId }>([{
        type: 'list', name: 'execId',
        message: chalk.white('  Who is the Executor?'),
        choices: selectedIds.filter(id => id !== archId),
      }]);
      activeCLIs = assignRolesManually(selectedIds, archId, execId);
    } else {
      activeCLIs = assignRolesFromAnalysis(analysis, selectedIds);
    }

    console.log('\n' + chalk.bold('  Role Assignment\n'));
    for (const cli of activeCLIs.configs) {
      const icon = cli.role === 'architect' ? '🏛' : cli.role === 'executor' ? '⚙' : '🔍';
      console.log(`  ${icon}  ${chalk.bold(cli.name.padEnd(32))}${chalk.dim(cli.role.toUpperCase())}`);
    }
    console.log(chalk.dim(`\n  ${getRoleReason(analysis)}\n`));
  }

  // ── Mode info ──────────────────────────────────────────────────────────────
  const hasTmux = tmuxAvailable();
  if (!hasTmux) {
    console.log(chalk.yellow('  ⚠  tmux not found — install it for the visual dashboard\n'));
  } else {
    const modeLabel = execMode === 'parallel-tracks'
      ? chalk.hex('#00efd4')('parallel tracks (each CLI owns a domain, INTERFACES.md as shared contract)')
      : chalk.hex('#00efd4')('sequential exchange (parallel build → review each other → fill gaps)');
    console.log(`  Mode: ${modeLabel}\n`);
  }

  // ── Confirm ────────────────────────────────────────────────────────────────
  const { go } = await inquirer.prompt<{ go: boolean }>([{
    type: 'confirm', name: 'go',
    message: chalk.white('Ready to build?'),
    default: true,
  }]);
  if (!go) { console.log(chalk.dim('\nAborted.\n')); process.exit(0); }
  console.log();

  // ── Orchestrate ────────────────────────────────────────────────────────────
  await runVisualOrchestration(brief, effectiveMethod, activeCLIs, projectDir);
}

main().catch(e => {
  console.error(chalk.red('\nError:'), e.message ?? e);
  process.exit(1);
});
