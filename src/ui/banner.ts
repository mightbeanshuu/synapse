import chalk from 'chalk';
import figlet from 'figlet';

export function showBanner(): void {
  console.clear();

  const art = figlet.textSync('SYNAPSE', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });

  console.log(chalk.cyan(art));
  console.log(chalk.gray('  Two AI CLIs. One project. Roles assigned. Built in parallel.'));
  console.log(chalk.dim('  v1.1.0  ·  Claude Code  +  Gemini CLI\n'));
}
