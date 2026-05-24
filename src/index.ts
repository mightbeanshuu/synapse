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
import { assignRolesFromAnalysis, getRoleReason } from './assigner';
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
  const boxWidth = Math.min(Math.max(cmd.length + 4, 50), 70);
  const inner = cmd.padEnd(boxWidth - 4);

  console.log();
  console.log(chalk.dim('  ╔══ SHELL COMMAND ') + chalk.dim('═'.repeat(boxWidth - 18)) + chalk.dim('╗'));
  console.log(`  ║  ${chalk.bold.white(inner)}  ` + chalk.dim('║'));
  console.log(chalk.dim('  ╚') + chalk.dim('═'.repeat(boxWidth)) + chalk.dim('╝'));

  const { action } = await inquirer.prompt<{ action: string }>([{
    type: 'expand',
    name: 'action',
    message: chalk.white('  Run?'),
    default: 'y',
    choices: [
      { key: 'y', name: 'Yes — run it',    value: 'yes'  },
      { key: 'n', name: 'No — skip',        value: 'no'   },
      { key: 'e', name: 'Edit command',     value: 'edit' },
    ],
  }]);

  let finalCmd = cmd;

  if (action === 'edit') {
    const { edited } = await inquirer.prompt<{ edited: string }>([{
      type: 'input',
      name: 'edited',
      message: chalk.white('  Command:'),
      default: cmd,
    }]);
    finalCmd = edited.trim() || cmd;
  }

  if (action === 'no') {
    console.log(chalk.dim('  Skipped.\n'));
    return false;
  }

  try {
    execSync(finalCmd, { stdio: 'ignore', cwd });
    console.log(chalk.green(`  ✓ Done\n`));
    return true;
  } catch (e: any) {
    console.log(chalk.red(`  ✗ Failed: ${e.message}\n`));
    return false;
  }
}

// ── Project directory ────────────────────────────────────────────────────────
async function resolveProjectDir(): Promise<string> {
  const { mode } = await inquirer.prompt<{ mode: string }>([{
    type: 'list',
    name: 'mode',
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
    fs.mkdirSync(dir, { recursive: true }); // ensure it exists even if skipped
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

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await showBanner();

  // ── Brief ─────────────────────────────────────────────────────────────────
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
  const available: Array<{ id: CLIId; label: string; installed: boolean }> = [
    { id: 'claude', label: 'Claude Code    (Architect by default)',                  installed: cliAvailable('claude') },
    { id: 'gemini', label: 'Gemini CLI     (Executor by default)',                   installed: cliAvailable('gemini') },
    { id: 'codex',  label: 'Codex CLI      (Reviewer — needs OPENAI_API_KEY)',       installed: cliAvailable('codex')  },
  ];

  const { selectedIds } = await inquirer.prompt<{ selectedIds: CLIId[] }>([{
    type: 'checkbox',
    name: 'selectedIds',
    message: chalk.white('Select CLIs to use (min 2):'),
    choices: available.map(c => ({
      name: c.installed
        ? `${c.label}`
        : `${c.label}  ${chalk.red('[not installed]')}`,
      value: c.id,
      checked: c.installed && (c.id === 'claude' || c.id === 'gemini'),
      disabled: !c.installed,
    })),
    validate: (v: CLIId[]) => v.length >= 2 || 'Select at least 2 CLIs',
  }]);

  console.log();

  // ── Connection method (multi-select with speed bars) ───────────────────────
  const { methodIds } = await inquirer.prompt<{ methodIds: string[] }>([{
    type: 'checkbox',
    name: 'methodIds',
    message: chalk.white('Connection methods (select any — fastest available wins):'),
    choices: CONNECTION_METHODS.map(m => {
      const speedBar = m.speedBar
        ? chalk.hex('#00efd4')(m.speedBar) + '  ' + chalk.bold(m.speedLabel ?? '')
        : '';
      const badge = m.badge ? chalk.hex('#ffdd00').bold(`  ${m.badge}`) : '';
      const comingSoon = !m.implemented ? chalk.red('  [coming soon]') : '';
      return {
        name: `${m.icon}  ${chalk.bold(m.name.padEnd(22))}${speedBar}${badge}${comingSoon}`,
        value: m.id,
        checked: m.id === 'named-pipe',
        disabled: !m.implemented,
      };
    }),
    validate: (v: string[]) => v.length >= 1 || 'Select at least one method',
  }]);

  const effectiveMethod = pickFastest(methodIds);
  const methodName = CONNECTION_METHODS.find(m => m.id === effectiveMethod)?.name ?? effectiveMethod;
  console.log(chalk.dim(`\n  Using: ${chalk.bold(methodName)} (fastest from your selection)\n`));

  // ── Project directory ──────────────────────────────────────────────────────
  const projectDir = await resolveProjectDir();

  // ── Connect ────────────────────────────────────────────────────────────────
  const connectSpinner = ora('Connecting to selected CLIs...').start();
  await new Promise(r => setTimeout(r, 500));
  connectSpinner.succeed(chalk.green(`Connected: ${selectedIds.join(', ')}`));

  // ── Analysis ──────────────────────────────────────────────────────────────
  const analysisSpinner = ora('Claude is analysing CLI capabilities (~15s)...').start();
  const analysis = await generateAnalysis(projectDir);
  analysisSpinner.succeed(chalk.green('Capability analysis complete'));

  console.log('\n' + chalk.bold('  Capability Comparison\n'));
  renderAnalysisTable(analysis);

  // ── Role assignment ────────────────────────────────────────────────────────
  const activeCLIs = assignRolesFromAnalysis(analysis, selectedIds);

  console.log('\n' + chalk.bold('  Role Assignment\n'));
  for (const cli of activeCLIs.configs) {
    const roleIcon = cli.role === 'architect' ? '🏛' : cli.role === 'executor' ? '⚙' : '🔍';
    console.log(`  ${roleIcon}  ${chalk.bold(cli.name.padEnd(32))}${chalk.dim(cli.role.toUpperCase())}`);
  }
  console.log(chalk.dim(`\n  ${getRoleReason(analysis)}\n`));

  // ── Mode info ──────────────────────────────────────────────────────────────
  const hasTmux = tmuxAvailable();
  console.log(`  Mode: ${hasTmux
    ? chalk.hex('#00efd4')('visual dashboard (split-pane terminal, CLIs build files for real)')
    : chalk.yellow('headless — install tmux for the visual dashboard')}\n`);

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
