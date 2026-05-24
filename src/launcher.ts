import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CLIConfig } from './types';

const SESSION = 'synapse';
const PHASE_MANAGER_SH = path.join(__dirname, 'phase-manager.sh');

export function tmuxAvailable(): boolean {
  try { execSync('which tmux', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function killSession(): void {
  try { execSync(`tmux kill-session -t ${SESSION} 2>/dev/null`, { stdio: 'ignore' }); } catch {}
}

function tmux(cmd: string): void {
  execSync(`tmux ${cmd}`, { stdio: 'ignore' });
}

function applyTheme(projectName: string): void {
  const set = (opt: string, val: string) => tmux(`set -t ${SESSION} ${opt} "${val}"`);
  set('status', 'on');
  set('status-interval', '5');
  set('status-style', 'bg=colour234 fg=colour250');
  set('status-left', '#[fg=colour39,bold] ⬡ SYNAPSE  #[fg=colour240,nobold]│  ');
  set('status-right', `#[fg=colour240]│  ${projectName}  │  #[fg=colour39]%(date "+%H:%M")  `);
  set('status-left-length', '30');
  set('status-right-length', '50');
  set('pane-border-style', 'fg=colour237');
  set('pane-active-border-style', 'fg=colour39');
  set('pane-border-status', 'top');
  set('pane-border-format', '#{?pane_active,#[fg=colour39 bold],#[fg=colour242]} #{pane_title}  ');
  set('window-style', 'bg=colour232');
  set('window-active-style', 'bg=colour232');
}

// ── Layout: CLI panes fill the full terminal (no bottom pane) ─────────────────
// Activity feed opens in a SEPARATE terminal window via osascript.
function buildLayout(cliCount: number): void {
  if (cliCount === 2) {
    // Two equal side-by-side columns
    tmux(`split-window -h -t "${SESSION}:0.0"`);
  } else {
    // Three equal columns: split right, then split right pane again
    tmux(`split-window -h -t "${SESSION}:0.0"`);
    tmux(`split-window -h -t "${SESSION}:0.1"`);
  }
}

// 2 CLIs → [0.0, 0.1], 3 CLIs → [0.0, 0.1, 0.2]
function cliPanes(cliCount: number): string[] {
  return cliCount === 2 ? ['0.0', '0.1'] : ['0.0', '0.1', '0.2'];
}

function setPaneTitle(pane: string, title: string): void {
  try { tmux(`select-pane -t "${pane}" -T "${title}"`); } catch {}
}

// ── Run script writer ─────────────────────────────────────────────────────────
function writeRunScript(
  scriptPath: string,
  cli: CLIConfig,
  promptFile: string,
  doneMarker: string,
  projectDir: string,
  logFile: string,
  bridgePath: string,
  phase: number,
  sessionDir: string
): void {
  let runCmd: string;
  if (cli.id === 'gemini') {
    runCmd = `gemini --yolo -p "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  } else if (cli.id === 'codex') {
    runCmd = `codex --approval-mode full-auto "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  } else {
    runCmd = `claude --dangerously-skip-permissions --print "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  }

  const guidanceBlock = phase === 2 ? `
GUIDANCE_FILE='${sessionDir}/guidance_${cli.id}.txt'
if [ -f "$GUIDANCE_FILE" ]; then
  GUIDANCE=$(cat "$GUIDANCE_FILE")
  PROMPT="$PROMPT

USER GUIDANCE FOR PHASE 2:
$GUIDANCE"
fi` : '';

  const label = cli.name.padEnd(46);
  const script = `#!/bin/bash
cd '${projectDir}'
PROMPT=$(cat '${promptFile}')
${guidanceBlock}
printf '\\033[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\033[0m\\n'
printf '\\033[1m  ${label}\\033[0m\\n'
printf '\\033[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\033[0m\\n'
echo ''
${runCmd}
echo ''
printf '\\033[32m  ✓ ${cli.name} done — signaling completion\\033[0m\\n'
echo "${doneMarker}" >> '${bridgePath}'
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
}

// ── Public types ──────────────────────────────────────────────────────────────
export interface LaunchOpts {
  clis: CLIConfig[];
  promptFiles: string[];
  bridgePath: string;
  projectDir: string;
  sessionDir: string;
}

// ── Write all run scripts for a phase ────────────────────────────────────────
export function writePhaseScripts(opts: LaunchOpts, phase: number, promptFiles: string[]): void {
  opts.clis.forEach((cli, i) => {
    const scriptPath = path.join(opts.sessionDir, `${cli.id}_p${phase}.sh`);
    const logFile    = path.join(opts.sessionDir, `${cli.id}_p${phase}.log`);
    const doneMarker = `${cli.id.toUpperCase()}_P${phase}_DONE`;
    writeRunScript(scriptPath, cli, promptFiles[i], doneMarker,
      opts.projectDir, logFile, opts.bridgePath, phase, opts.sessionDir);
  });
}

// ── Launch the tmux dashboard + open activity feed in separate terminal ───────
export function launchDashboard(opts: LaunchOpts): void {
  const { clis, promptFiles, bridgePath, projectDir, sessionDir } = opts;

  killSession();
  tmux(`new-session -d -s ${SESSION} -x 260 -y 60`);
  applyTheme(path.basename(projectDir));
  buildLayout(clis.length);

  const panes = cliPanes(clis.length);

  // Launch P1 scripts in CLI panes
  clis.forEach((cli, i) => {
    const pane      = panes[i];
    const scriptPath = path.join(sessionDir, `${cli.id}_p1.sh`);
    const logFile    = path.join(sessionDir, `${cli.id}_p1.log`);
    const doneMarker = `${cli.id.toUpperCase()}_P1_DONE`;
    writeRunScript(scriptPath, cli, promptFiles[i], doneMarker, projectDir, logFile, bridgePath, 1, sessionDir);
    setPaneTitle(`${SESSION}:${pane}`, `${cli.name}  ·  Phase 1`);
    tmux(`send-keys -t "${SESSION}:${pane}" "bash '${scriptPath}'" Enter`);
  });

  // Write a feed launcher script (avoids osascript quoting hell)
  const cliIds     = clis.map(c => c.id).join(' ');
  const feedScript = path.join(sessionDir, '_feed.sh');
  fs.writeFileSync(feedScript, [
    '#!/bin/bash',
    `bash '${PHASE_MANAGER_SH}' \\`,
    `  '${bridgePath}' \\`,
    `  '${sessionDir}' \\`,
    `  '${projectDir}' \\`,
    `  '${SESSION}' ${clis.length} ${cliIds}`,
  ].join('\n'), { mode: 0o755 });

  // Open activity feed in a dedicated separate Terminal.app window
  execSync(`osascript -e 'tell application "Terminal" to do script "bash ${feedScript}"'`);
}

// ── Attach tmux to current terminal (blocks until phase-manager detaches) ────
export function attachToCurrentTerminal(): void {
  spawnSync('tmux', ['attach-session', '-t', SESSION], { stdio: 'inherit' });
}
