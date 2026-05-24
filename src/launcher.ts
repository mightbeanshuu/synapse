import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CLIConfig } from './types';
import type { SignalingChannel } from './connect/signaling';

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

function writeRunScript(
  scriptPath: string,
  cli: CLIConfig,
  promptFile: string,
  doneMarker: string,
  projectDir: string,
  logFile: string,
  signalCmd: string
): void {
  let runCmd: string;
  if (cli.id === 'gemini') {
    runCmd = `gemini --yolo -p "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  } else if (cli.id === 'codex') {
    runCmd = `codex --approval-mode full-auto "$PROMPT" 2>&1 | tee -a "${logFile}"`;
  } else {
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
printf '\\033[32m  ✓ ${cli.name} done — signaling completion\\033[0m\\n'
${signalCmd}
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
}

function buildLayout(cliCount: number): void {
  tmux(`split-window -v -t "${SESSION}:0.0" -p 25`);

  if (cliCount === 2) {
    tmux(`split-window -h -t "${SESSION}:0.0"`);
  } else {
    tmux(`split-window -h -t "${SESSION}:0.0" -p 66`);
    tmux(`split-window -h -t "${SESSION}:0.0"`);
  }
}

function setPaneTitle(pane: string, title: string): void {
  try { tmux(`select-pane -t "${pane}" -T "${title}"`); } catch {}
}

function cliPanes(cliCount: number): string[] {
  return cliCount === 2 ? ['0.0', '0.2'] : ['0.0', '0.2', '0.3'];
}

const MONITOR_PANE = '0.1';

export interface LaunchOpts {
  clis: CLIConfig[];
  promptFiles: string[];
  bridgePath: string;
  phase: number;
  projectDir: string;
  sessionDir: string;
  signalingChannel: SignalingChannel;
}

export function launchDashboard(opts: LaunchOpts): void {
  const { clis, promptFiles, bridgePath, phase, projectDir, sessionDir, signalingChannel } = opts;

  killSession();
  tmux(`new-session -d -s ${SESSION} -x 260 -y 60`);

  const projectName = path.basename(projectDir);
  applyTheme(projectName);
  buildLayout(clis.length);

  const panes = cliPanes(clis.length);

  clis.forEach((cli, i) => {
    const pane = panes[i];
    const scriptPath = path.join(sessionDir, `${cli.id}_p${phase}.sh`);
    const logFile = path.join(sessionDir, `${cli.id}_p${phase}.log`);
    const doneMarker = `${cli.id.toUpperCase()}_P${phase}_DONE`;
    const signalCmd = signalingChannel.signalCmdFor(doneMarker);

    writeRunScript(scriptPath, cli, promptFiles[i], doneMarker, projectDir, logFile, signalCmd);
    setPaneTitle(`${SESSION}:${pane}`, `${cli.name}  ·  Phase ${phase}`);
    tmux(`send-keys -t "${SESSION}:${pane}" "bash '${scriptPath}'" Enter`);
  });

  const cliNames = clis.map(c => c.id).join(' ');
  setPaneTitle(`${SESSION}:${MONITOR_PANE}`, '⬡  Activity Feed  —  real-time');
  tmux(`send-keys -t "${SESSION}:${MONITOR_PANE}" "bash '${MONITOR_SH}' '${bridgePath}' '${projectDir}' ${cliNames}" Enter`);

  execSync(`osascript -e 'tell application "Terminal" to do script "tmux attach -t ${SESSION}"'`);
}

export function relaunchPhase(opts: LaunchOpts): void {
  const { clis, promptFiles, bridgePath, phase, projectDir, sessionDir, signalingChannel } = opts;
  const panes = cliPanes(clis.length);

  clis.forEach((cli, i) => {
    const pane = panes[i];
    const scriptPath = path.join(sessionDir, `${cli.id}_p${phase}.sh`);
    const logFile = path.join(sessionDir, `${cli.id}_p${phase}.log`);
    const doneMarker = `${cli.id.toUpperCase()}_P${phase}_DONE`;
    const signalCmd = signalingChannel.signalCmdFor(doneMarker);

    writeRunScript(scriptPath, cli, promptFiles[i], doneMarker, projectDir, logFile, signalCmd);

    try {
      setPaneTitle(`${SESSION}:${pane}`, `${cli.name}  ·  Phase ${phase}`);
      tmux(`send-keys -t "${SESSION}:${pane}" "" ""`);
      tmux(`send-keys -t "${SESSION}:${pane}" "bash '${scriptPath}'" Enter`);
    } catch {
      launchDashboard(opts);
    }
  });
}
