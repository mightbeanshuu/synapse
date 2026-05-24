import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CLIConfig } from './types';
import { registerMCP, cleanupMCP } from './mcp/register';

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

function openTerminalWindow(cmd: string): void {
  const escaped = cmd.replace(/\\/g, '\\\\')
                     .replace(/"/g, '\\"')
                     .replace(/'/g, "'\\''");
  execSync(`osascript -e 'tell application "Terminal" to do script "${escaped}"'`);
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
  failMarker: string,
  projectDir: string,
  logFile: string,
  bridgePath: string,
  phase: number,
  sessionDir: string,
  safeMode = false
): void {
  let runCmd: string;
  const symbolPrefix = `${cli.symbol} `;
  if (cli.id === 'gemini') {
    // Safe mode: remove --yolo so Gemini asks before actions
    const yolo = safeMode ? '' : '--yolo';
    runCmd = `gemini ${yolo} -p "$PROMPT" 2>&1 | LC_ALL=C sed "s/^/${symbolPrefix}/" | tee -a "${logFile}"`;
  } else if (cli.id === 'codex') {
    const approval = safeMode ? '--ask-for-approval on-request' : '--ask-for-approval never';
    runCmd = `codex ${approval} exec "$PROMPT" 2>&1 | LC_ALL=C sed "s/^/${symbolPrefix}/" | tee -a "${logFile}"`;
  } else {
    // Safe mode: no --dangerously-skip-permissions, Claude will ask in its tmux pane
    const perms = safeMode ? '' : '--dangerously-skip-permissions';
    runCmd = `claude ${perms} --print "$PROMPT" 2>&1 | LC_ALL=C sed "s/^/${symbolPrefix}/" | tee -a "${logFile}"`;
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
RC=$?
echo ''
if [ "$RC" -eq 0 ]; then
  printf '\\033[32m  ✓ ${cli.name} completed\\033[0m\\n'
  echo "${doneMarker}" >> '${bridgePath}'
else
  printf '\\033[31m  ✗ ${cli.name} failed (exit %s)\\033[0m\\n' "$RC"
  echo "${failMarker}" >> '${bridgePath}'
fi
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
  sessionId: string;
  safeMode?: boolean;
  useMCP?: boolean;
}

// ── Write all run scripts for a phase ────────────────────────────────────────
export function writePhaseScripts(opts: LaunchOpts, phase: number, promptFiles: string[]): void {
  opts.clis.forEach((cli, i) => {
    const scriptPath = path.join(opts.sessionDir, `${cli.id}_p${phase}.sh`);
    const logFile    = path.join(opts.sessionDir, `${cli.id}_p${phase}.log`);
    const doneMarker = `${cli.id.toUpperCase()}_P${phase}_DONE`;
    const failMarker = `${cli.id.toUpperCase()}_P${phase}_FAILED`;
    writeRunScript(scriptPath, cli, promptFiles[i], doneMarker, failMarker,
      opts.projectDir, logFile, opts.bridgePath, phase, opts.sessionDir, opts.safeMode);
  });
}

// ── Launch the tmux dashboard + open activity feed in separate terminal ───────
export function launchDashboard(opts: LaunchOpts): void {
  const { clis, promptFiles, bridgePath, projectDir, sessionDir, sessionId } = opts;
  const cliIds = clis.map(c => c.id);

  // Register MCP server with all CLIs before launching
  const mcpStateDir = path.join(sessionDir, 'mcp');
  fs.mkdirSync(mcpStateDir, { recursive: true });
  if (opts.useMCP !== false) {
    try {
      const mcpName = registerMCP(sessionId, mcpStateDir, projectDir, cliIds);
      fs.writeFileSync(path.join(sessionDir, '.mcp_name'), mcpName);
      fs.writeFileSync(path.join(sessionDir, '.mcp_state_dir'), mcpStateDir);
    } catch {}
  }

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
    const failMarker = `${cli.id.toUpperCase()}_P1_FAILED`;
    writeRunScript(scriptPath, cli, promptFiles[i], doneMarker, failMarker, projectDir, logFile, bridgePath, 1, sessionDir, opts.safeMode);
    setPaneTitle(`${SESSION}:${pane}`, `${cli.name}  ·  Phase 1`);
    tmux(`send-keys -t "${SESSION}:${pane}" "bash '${scriptPath}'" Enter`);
  });

  // Write metadata files so phase-manager can open streams on-demand
  const interactiveStreamSh = path.join(__dirname, 'interactive-stream.sh');
  const pipePath = path.join(sessionDir, 'commands.pipe');
  const safeModeFlag = opts.safeMode ? '1' : '0';

  fs.writeFileSync(path.join(sessionDir, '.safe_mode'), safeModeFlag);
  fs.writeFileSync(
    path.join(sessionDir, '.cli_meta'),
    clis.map(c => `${c.id}:${c.symbol}`).join('\n')
  );
  fs.writeFileSync(
    path.join(sessionDir, '.stream_sh'),
    interactiveStreamSh
  );

  // Write a feed launcher script (command center + summary)
  const cliIdStr   = cliIds.join(' ');
  const feedScript = path.join(sessionDir, '_feed.sh');
  fs.writeFileSync(feedScript, [
    '#!/bin/bash',
    `bash '${PHASE_MANAGER_SH}' \\`,
    `  '${bridgePath}' \\`,
    `  '${sessionDir}' \\`,
    `  '${projectDir}' \\`,
    `  '${SESSION}' ${clis.length} ${cliIdStr}`,
  ].join('\n'), { mode: 0o755 });

  // Only open the command center — live streams open on-demand via /c /g /x
  openTerminalWindow(`bash '${feedScript}'`);
}

// ── Attach tmux to current terminal (blocks until phase-manager detaches) ────
export function attachToCurrentTerminal(): void {
  spawnSync('tmux', ['attach-session', '-t', SESSION], { stdio: 'inherit' });
}

// ── MCP cleanup (called after session completes) ──────────────────────────────
export function cleanupSession(opts: Pick<LaunchOpts, 'sessionId' | 'projectDir' | 'clis'>): void {
  try {
    cleanupMCP(opts.sessionId, opts.projectDir, opts.clis.map(c => c.id));
  } catch {}
}
