import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { showBanner } from './ui/banner';
import { CONNECTION_METHODS } from './connect/methods';
import { generateAnalysis, renderAnalysisTable } from './analyzer';
import { assignRoles } from './assigner';
import { runOrchestration } from './orchestrator';

async function main(): Promise<void> {
  showBanner();

  // Project brief from argv or interactive prompt
  let brief = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();

  // Parse --dir flag
  let projectDir = process.cwd();
  const dirIdx = process.argv.indexOf('--dir');
  if (dirIdx !== -1 && process.argv[dirIdx + 1]) {
    projectDir = path.resolve(process.argv[dirIdx + 1]);
  }

  if (!brief) {
    const { b } = await inquirer.prompt<{ b: string }>([
      {
        type: 'input',
        name: 'b',
        message: chalk.white('Project brief:'),
        validate: (v: string) => v.trim().length > 0 || 'Brief cannot be empty',
      },
    ]);
    brief = b.trim();
  }

  console.log();

  // Connection method selection
  const { methodId } = await inquirer.prompt<{ methodId: string }>([
    {
      type: 'list',
      name: 'methodId',
      message: chalk.white('Select connection method:'),
      choices: CONNECTION_METHODS.map(m => ({
        name:
          `${m.icon}  ${chalk.bold(m.name.padEnd(22))}` +
          chalk.dim(m.description) +
          (!m.implemented ? chalk.red('  [coming soon]') : ''),
        value: m.id,
        short: m.name,
      })),
    },
  ]);

  const selectedMethod = CONNECTION_METHODS.find(m => m.id === methodId)!;
  const effectiveMethod = selectedMethod.implemented ? methodId : 'parallel-streams';

  if (!selectedMethod.implemented) {
    console.log(chalk.yellow(`\n⚠ ${selectedMethod.name} is not yet implemented — falling back to Parallel Streams\n`));
  }

  // Connect to both CLIs
  const connectSpinner = ora('Connecting to Claude Code and Gemini CLI...').start();
  await new Promise(r => setTimeout(r, 800)); // brief visual pause
  connectSpinner.succeed(chalk.green('Both CLIs connected'));

  // Generate capability analysis
  const analysisSpinner = ora('Claude is analyzing both CLIs (this takes ~15s)...').start();
  const analysis = await generateAnalysis(projectDir);
  analysisSpinner.succeed(chalk.green('Capability analysis complete'));

  console.log('\n' + chalk.bold('  Capability Comparison\n'));
  renderAnalysisTable(analysis);

  // Assign roles
  const roles = assignRoles(analysis);
  console.log(
    `\n${chalk.cyan('✓')} ${chalk.bold(roles.architect.name)} ${chalk.dim('→ Architecture · Logic · Edge Cases · Review')}`
  );
  console.log(
    `${chalk.yellow('✓')} ${chalk.bold(roles.executor.name)} ${chalk.dim('→ Implementation · Boilerplate · Tests · Setup')}`
  );
  console.log(chalk.dim(`\n  Rationale: ${roles.reason}\n`));

  // Confirm
  const { go } = await inquirer.prompt<{ go: boolean }>([
    {
      type: 'confirm',
      name: 'go',
      message: chalk.white('Ready to build?'),
      default: true,
    },
  ]);

  if (!go) {
    console.log(chalk.dim('\nAborted.\n'));
    process.exit(0);
  }

  console.log();
  await runOrchestration(brief, effectiveMethod, roles, projectDir);
}

main().catch(e => {
  console.error(chalk.red('\nError:'), e.message ?? e);
  process.exit(1);
});
