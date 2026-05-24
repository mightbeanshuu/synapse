import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { showBanner } from './ui/banner';
import { CONNECTION_METHODS } from './connect/methods';
import { generateAnalysis, renderAnalysisTable } from './analyzer';
import { assignRoles } from './assigner';
import { runOrchestration } from './orchestrator';
import { runVisualOrchestration } from './visual-orchestrator';
import { tmuxAvailable } from './launcher';

async function resolveProjectDir(): Promise<string> {
  const { mode } = await inquirer.prompt<{ mode: string }>([{
    type: 'list',
    name: 'mode',
    message: chalk.white('Project directory:'),
    choices: [
      { name: '✦  Create new project folder on Desktop', value: 'new' },
      { name: '📁  Use existing directory', value: 'existing' },
    ],
  }]);

  if (mode === 'new') {
    const { name } = await inquirer.prompt<{ name: string }>([{
      type: 'input',
      name: 'name',
      message: chalk.white('Project name:'),
      validate: (v: string) => v.trim().length > 0 || 'Name cannot be empty',
    }]);

    const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const dir = path.join(os.homedir(), 'Desktop', slug);
    fs.mkdirSync(dir, { recursive: true });

    try { execSync('git init', { cwd: dir, stdio: 'ignore' }); } catch {}

    console.log(chalk.dim(`\n  Created: ${dir}\n`));
    return dir;
  }

  const { dir } = await inquirer.prompt<{ dir: string }>([{
    type: 'input',
    name: 'dir',
    message: chalk.white('Directory path:'),
    default: process.cwd(),
    validate: (v: string) => fs.existsSync(v.trim()) || 'Directory does not exist',
  }]);

  return path.resolve(dir.trim());
}

async function main(): Promise<void> {
  showBanner();

  // ── Brief ────────────────────────────────────────────────────────────────
  let brief = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();

  if (!brief) {
    const { b } = await inquirer.prompt<{ b: string }>([{
      type: 'input',
      name: 'b',
      message: chalk.white('Project brief:'),
      validate: (v: string) => v.trim().length > 0 || 'Brief cannot be empty',
    }]);
    brief = b.trim();
  }

  console.log();

  // ── Connection method ────────────────────────────────────────────────────
  const { methodId } = await inquirer.prompt<{ methodId: string }>([{
    type: 'list',
    name: 'methodId',
    message: chalk.white('Connection method:'),
    choices: CONNECTION_METHODS.map(m => ({
      name:
        `${m.icon}  ${chalk.bold(m.name.padEnd(22))}` +
        chalk.dim(m.description) +
        (!m.implemented ? chalk.red('  [coming soon]') : ''),
      value: m.id,
      short: m.name,
    })),
  }]);

  const selectedMethod = CONNECTION_METHODS.find(m => m.id === methodId)!;
  const effectiveMethod = selectedMethod.implemented ? methodId : 'parallel-streams';
  if (!selectedMethod.implemented) {
    console.log(chalk.yellow(`\n⚠ Falling back to Parallel Streams\n`));
  }

  // ── Project directory ─────────────────────────────────────────────────────
  const projectDir = await resolveProjectDir();

  // ── Connect ───────────────────────────────────────────────────────────────
  const connectSpinner = ora('Connecting to Claude Code and Gemini CLI...').start();
  await new Promise(r => setTimeout(r, 600));
  connectSpinner.succeed(chalk.green('Both CLIs connected'));

  // ── Analysis ──────────────────────────────────────────────────────────────
  const analysisSpinner = ora('Claude is analysing both CLIs (~15s)...').start();
  const analysis = await generateAnalysis(projectDir);
  analysisSpinner.succeed(chalk.green('Capability analysis complete'));

  console.log('\n' + chalk.bold('  Capability Comparison\n'));
  renderAnalysisTable(analysis);

  // ── Role assignment ───────────────────────────────────────────────────────
  const roles = assignRoles(analysis);
  console.log(`\n${chalk.cyan('✓')} ${chalk.bold(roles.architect.name)} ${chalk.dim('→ Architecture · Logic · Edge Cases · Review')}`);
  console.log(`${chalk.yellow('✓')} ${chalk.bold(roles.executor.name)} ${chalk.dim('→ Implementation · Boilerplate · Tests · Setup')}`);
  console.log(chalk.dim(`\n  Rationale: ${roles.reason}\n`));

  // ── Confirm ───────────────────────────────────────────────────────────────
  const hasTmux = tmuxAvailable();
  const modeLabel = hasTmux
    ? chalk.cyan('visual (two terminal panes, CLIs build files for real)')
    : chalk.yellow('headless (captured output only — install tmux for visual mode)');

  console.log(`  Mode: ${modeLabel}\n`);

  const { go } = await inquirer.prompt<{ go: boolean }>([{
    type: 'confirm',
    name: 'go',
    message: chalk.white('Ready to build?'),
    default: true,
  }]);

  if (!go) { console.log(chalk.dim('\nAborted.\n')); process.exit(0); }

  console.log();

  // ── Orchestrate ───────────────────────────────────────────────────────────
  if (hasTmux) {
    await runVisualOrchestration(brief, effectiveMethod, roles, projectDir);
  } else {
    await runOrchestration(brief, effectiveMethod, roles, projectDir);
  }
}

main().catch(e => {
  console.error(chalk.red('\nError:'), e.message ?? e);
  process.exit(1);
});
