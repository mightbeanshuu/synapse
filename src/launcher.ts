import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CLIConfig } from './types';

const SESSION = 'synapse';
const MONITOR_SH = path.join(__dirname, 'monitor.sh');

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

// ── Style the session (status bar + pane borders) ───────────────────────────
function applyTheme(projectName: string): void {
  const setGlobal = (opt: string, val: string) =>
    tmux(`set -t ${SESSION} ${opt} "${val}"`);

  setGlobal('status', 'on');
  setGlobal('status-interval', '5');
  setGlobal('status-style', 'bg=colour234 fg=colour250');
  setGlobal('status-left', '#[fg=colour39,bold] ⬡ SYNAPSE  #[fg=colour240,nobold]│  ');
  setGlobal('status-right', `#[fg=colour240]│  ${projectName}  │  #[fg=colour39]%(date "+%H:%M")  `);
  setGlobal('status-left-length', '30');
  setGlobal('status-right-length', '50');

  setGlobal('pane-border-style', 'fg=colour237');
  setGlobal('pane-active-border-style', 'fg=colour39');
  setGlobal('pane-border-status', 'top');
  setGlobal('pane-border-format',
    '#{?pane_active,#[fg=colour39 bold],#[fg=colour242]} #{pane_title}  ');

  setGlobal('window-style', 'bg=colour232');
  setGlobal('window-active-style', 'bg=colour232');
}

// ── Write a run script for one CLI ──────────────────────────────────────────
function writeRunScript(
  scriptPath: string,
  cli: CLIConfig,
  promptFile: string,
  bridgePath: string,
  doneMarker: string,
  projectDir: string,
  logFile: string
): void {
  let runCmd: string;
  if (cli.id === 'gemini') {
    runCmd = `gemini --yolo -p "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  } else if (cli.id === 'codex') {
    runCmd = `codex --approval-mode full-auto "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  } else {
    // claude — --print streams all tool calls visually, --dangerously-skip-permissions auto-approves
    runCmd = `claude --dangerously-skip-permissions --print "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  }

  const label = cli.name.padEnd(46);
  const script = `#!/bin/bash
cd '${projectDir}'
PROMPT=$(cat '${promptFile}')
printf '\\033[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\033[0m\\n'
printf '\\033[1m  ${label}\\033[0m\\n'
printf '\\033[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\033[0m\\n'
echo ''
${runCmd}
echo ''
printf '\\033[32m  ✓ ${cli.name} done — writing completion marker\\033[0m\\n'
echo "${doneMarker}" >> '${bridgePath}'
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
}

// ── Create tmux layout depending on CLI count ─────────────────────────────
function buildLayout(cliCount: number): void {
  // Step 1: full pane → split bottom 25% for activity feed
  tmux(`split-window -v -t "${SESSION}:0.0" -p 25`);

  if (cliCount === 2) {
    // Split top pane 50/50
    tmux(`split-window -h -t "${SESSION}:0.0"`);
    // Pane order: 0.0 = top-left (CLI1), 0.1 = bottom (monitor), 0.2 = top-right (CLI2)
  } else {
    // Split top pane into thirds: first split at 66%, then split left at 50%
    tmux(`split-window -h -t "${SESSION}:0.0" -p 66`);
    tmux(`split-window -h -t "${SESSION}:0.0"`);
    // Pane order: 0.0 = top-left (CLI1), 0.1 = bottom (monitor), 0.2 = top-mid (CLI2), 0.3 = top-right (CLI3)
  }
}

function setPaneTitle(pane: string, title: string): void {
  try { tmux(`select-pane -t "${pane}" -T "${title}"`); } catch {}
}

// ── Map pane indices per CLI count ───────────────────────────────────────────
// With 2 CLIs: panes 0,2 are CLIs; pane 1 is monitor
// With 3 CLIs: panes 0,2,3 are CLIs; pane 1 is monitor
function cliPanes(cliCount: number): string[] {
  return cliCount === 2 ? ['0.0', '0.2'] : ['0.0', '0.2', '0.3'];
}

const MONITOR_PANE = '0.1';

// ── Public launch ────────────────────────────────────────────────────────────
export interface LaunchOpts {
  clis: CLIConfig[];
  promptFiles: string[];      // one per CLI, same order as clis
  bridgePath: string;
  phase: number;
  projectDir: string;
  sessionDir: string;
}

export function launchDashboard(opts: LaunchOpts): void {
  const { clis, promptFiles, bridgePath, phase, projectDir, sessionDir } = opts;

  killSession();
  tmux(`new-session -d -s ${SESSION} -x 260 -y 60`);

  const projectName = path.basename(projectDir);
  applyTheme(projectName);
  buildLayout(clis.length);

  const panes = cliPanes(clis.length);

  // Launch each CLI in its pane
  clis.forEach((cli, i) => {
    const pane = panes[i];
    const scriptPath = path.join(sessionDir, `${cli.id}_p${phase}.sh`);
    const logFile = path.join(sessionDir, `${cli.id}_p${phase}.log`);
    const doneMarker = `${cli.id.toUpperCase()}_P${phase}_DONE`;

    writeRunScript(scriptPath, cli, promptFiles[i], bridgePath, doneMarker, projectDir, logFile);
    setPaneTitle(`${SESSION}:${pane}`, `${cli.name}  ·  Phase ${phase}`);
    tmux(`send-keys -t "${SESSION}:${pane}" "bash '${scriptPath}'" Enter`);
  });

  // Activity monitor in bottom pane
  const cliNames = clis.map(c => c.id).join(' ');
  setPaneTitle(`${SESSION}:${MONITOR_PANE}`, '⬡  Activity Feed  —  real-time');
  tmux(`send-keys -t "${SESSION}:${MONITOR_PANE}" "bash '${MONITOR_SH}' '${bridgePath}' '${projectDir}' ${cliNames}" Enter`);

  // Open in a new Terminal.app window
  execSync(`osascript -e 'tell application "Terminal" to do script "tmux attach -t ${SESSION}"'`);
}

// ── Reuse existing session for next phase ────────────────────────────────────
export function relaunchPhase(opts: LaunchOpts): void {
  const { clis, promptFiles, bridgePath, phase, projectDir, sessionDir } = opts;
  const panes = cliPanes(clis.length);

  clis.forEach((cli, i) => {
    const pane = panes[i];
    const scriptPath = path.join(sessionDir, `${cli.id}_p${phase}.sh`);
    const logFile = path.join(sessionDir, `${cli.id}_p${phase}.log`);
    const doneMarker = `${cli.id.toUpperCase()}_P${phase}_DONE`;

    writeRunScript(scriptPath, cli, promptFiles[i], bridgePath, doneMarker, projectDir, logFile);

    try {
      setPaneTitle(`${SESSION}:${pane}`, `${cli.name}  ·  Phase ${phase}`);
      tmux(`send-keys -t "${SESSION}:${pane}" "" ""`); // clear any stale input
      tmux(`send-keys -t "${SESSION}:${pane}" "bash '${scriptPath}'" Enter`);
    } catch {
      // Session gone — relaunch fresh
      launchDashboard(opts);
    }
  });
}

// ── Poll bridge for completion markers ──────────────────────────────────────
export function waitForMarkers(
  bridgePath: string,
  markers: string[],
  timeoutMs: number,
  onProgress?: (found: string[], total: string[]) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const found = new Set<string>();

    const iv = setInterval(() => {
      try {
        const content = fs.existsSync(bridgePath) ? fs.readFileSync(bridgePath, 'utf8') : '';
        let changed = false;
        for (const m of markers) {
          if (!found.has(m) && content.includes(m)) {
            found.add(m);
            changed = true;
          }
        }
        if (changed && onProgress) onProgress([...found], markers);
        if (found.size === markers.length) { clearInterval(iv); resolve(true); return; }
      } catch {}
      if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(false); }
    }, 2000);
  });
}
