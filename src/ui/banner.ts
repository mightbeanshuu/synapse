import chalk from 'chalk';
import figlet from 'figlet';

// Left-to-right gradient stops: electric blue → bright cyan → teal
const GRADIENT_STOPS: Array<{ pos: number; r: number; g: number; b: number }> = [
  { pos: 0.00, r: 0x5c, g: 0x7c, b: 0xff }, // electric blue
  { pos: 0.30, r: 0x00, g: 0xb8, b: 0xff }, // sky blue
  { pos: 0.60, r: 0x00, g: 0xef, b: 0xd4 }, // bright cyan-teal
  { pos: 1.00, r: 0x00, g: 0xff, b: 0xaa }, // neon teal
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
  return `#00ffaa`;
}

function gradientLine(line: string, maxWidth: number, indent: string): string {
  const chars = [...line]; // spread for correct Unicode iteration
  return indent + chars.map((ch, i) => {
    if (ch === ' ') return ch;
    return chalk.hex(lerpColor(i / maxWidth)).bold(ch);
  }).join('');
}

export function showBanner(): void {
  console.clear();

  const art = figlet.textSync('SYNAPSE', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });

  const lines = art.split('\n');

  // strip trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const maxWidth = Math.max(...lines.map(l => [...l].length));
  const indent = '  ';

  // ── top bar ─────────────────────────────────────────────────────────────
  const barWidth = Math.min(maxWidth + 4, 72);
  const topBar = chalk.hex('#5c7cff')('▄'.repeat(barWidth));

  console.log();
  console.log(indent + topBar);
  console.log();

  // ── gradient ASCII art ───────────────────────────────────────────────────
  for (const line of lines) {
    console.log(gradientLine(line, maxWidth, indent));
  }

  // ── bottom decoration ────────────────────────────────────────────────────
  console.log();

  const sep = chalk.dim('─').repeat(barWidth);
  console.log(indent + sep);

  const dot   = chalk.hex('#00efd4')('◈');
  const label = chalk.white.bold(' Multi-CLI Orchestrator');
  const dim   = chalk.dim('  ·  v1.1.0  ·  Claude Code  ×  Gemini CLI');
  console.log(`${indent}${dot}${label}${dim}`);

  const pulse = chalk.dim('  ⟨ neural link ready ⟩');
  const tagline = chalk.hex('#00b8ff')('  Two minds. One build. Zero waiting.');
  console.log(`${indent}${chalk.hex('#00efd4')('◈')}${tagline}${pulse}`);

  console.log(indent + sep);
  console.log();
}
