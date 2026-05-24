import chalk from 'chalk';
import figlet from 'figlet';

const GRADIENT_STOPS: Array<{ pos: number; r: number; g: number; b: number }> = [
  { pos: 0.00, r: 0x5c, g: 0x7c, b: 0xff },
  { pos: 0.30, r: 0x00, g: 0xb8, b: 0xff },
  { pos: 0.60, r: 0x00, g: 0xef, b: 0xd4 },
  { pos: 1.00, r: 0x00, g: 0xff, b: 0xaa },
];

function lerpColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const a = GRADIENT_STOPS[i];
    const b = GRADIENT_STOPS[i + 1];
    if (clamped >= a.pos && clamped <= b.pos) {
      const lt = (clamped - a.pos) / (b.pos - a.pos);
      const r = Math.round(a.r + (b.r - a.r) * lt);
      const g = Math.round(a.g + (b.g - a.g) * lt);
      const bl = Math.round(a.b + (b.b - a.b) * lt);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
    }
  }
  return '#00ffaa';
}

function gradientLine(line: string, maxWidth: number, indent: string): string {
  const chars = [...line];
  return indent + chars.map((ch, i) => {
    if (ch === ' ') return ch;
    return chalk.hex(lerpColor(i / maxWidth)).bold(ch);
  }).join('');
}

function renderFrame(word: string, showSubtitle: boolean): void {
  process.stdout.write('\x1Bc'); // clear terminal

  const art = figlet.textSync(word, {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });

  const lines = art.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const maxWidth = Math.max(...lines.map(l => [...l].length));
  const indent = '  ';
  const barWidth = Math.min(maxWidth + 4, 72);

  process.stdout.write('\n');
  process.stdout.write(indent + chalk.hex('#5c7cff')('▄'.repeat(barWidth)) + '\n');
  process.stdout.write('\n');

  for (const line of lines) {
    process.stdout.write(gradientLine(line, maxWidth, indent) + '\n');
  }

  process.stdout.write('\n');

  if (showSubtitle) {
    const sep = chalk.dim('─').repeat(barWidth);
    process.stdout.write(indent + sep + '\n');

    const dot = chalk.hex('#00efd4')('◈');
    const label = chalk.white.bold(' Multi-CLI Orchestrator');
    const dim = chalk.dim('  ·  v1.4.0  ·  Claude  ×  Gemini  ×  Codex');
    process.stdout.write(`${indent}${dot}${label}${dim}\n`);

    const tagline = chalk.hex('#00b8ff')('  Two minds. One build. Zero waiting.');
    const pulse = chalk.dim('  ⟨ neural link ready ⟩');
    process.stdout.write(`${indent}${chalk.hex('#00efd4')('◈')}${tagline}${pulse}\n`);

    // Quota / session indicator
    const sessionDot = chalk.hex('#00ff88')('●');
    const sessionLine = chalk.dim('  Session active  ·  ') +
      chalk.hex('#00efd4')('claude.ai/usage') +
      chalk.dim(' for quota  ·  ') +
      chalk.hex('#00b8ff')('FIFO + TCP') +
      chalk.dim(' signaling ready');
    process.stdout.write(`${indent}${sessionDot}${sessionLine}\n`);

    process.stdout.write(indent + sep + '\n');
    process.stdout.write('\n');
  }
}

const FRAMES = ['S', 'SY', 'SYN', 'SYNA', 'SYNAP', 'SYNAPS', 'SYNAPSE'];

export async function showBanner(): Promise<void> {
  for (let i = 0; i < FRAMES.length; i++) {
    const isLast = i === FRAMES.length - 1;
    renderFrame(FRAMES[i], isLast);
    if (!isLast) {
      await new Promise(r => setTimeout(r, 75));
    }
  }
}
