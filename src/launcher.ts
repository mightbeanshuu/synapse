import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const SESSION = 'synapse';

export function tmuxAvailable(): boolean {
  try { execSync('which tmux', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function killSession(): void {
  try { execSync(`tmux kill-session -t ${SESSION}`, { stdio: 'ignore' }); } catch {}
}

// Write a shell script that runs a CLI agentic session and signals done
function writeRunScript(
  scriptPath: string,
  binary: string,
  promptFile: string,
  bridgePath: string,
  doneMarker: string,
  projectDir: string,
  label: string
): void {
  const labelBar = `echo "" && echo "┌─────────────────────────────────────────────┐" && echo "│  ${label.padEnd(45)}│" && echo "└─────────────────────────────────────────────┘" && echo ""`;

  const script =
    binary === 'gemini'
      ? `#!/bin/bash
cd '${projectDir}'
${labelBar}
PROMPT=$(cat '${promptFile}')
gemini --yolo -p "$PROMPT"
echo "${doneMarker}" >> '${bridgePath}'
`
      : `#!/bin/bash
cd '${projectDir}'
${labelBar}
PROMPT=$(cat '${promptFile}')
claude --dangerously-skip-permissions --print "$PROMPT"
echo "${doneMarker}" >> '${bridgePath}'
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
}

export interface LaunchOpts {
  projectDir: string;
  claudePromptFile: string;
  geminiPromptFile: string;
  bridgePath: string;
  phase: number;
  architectName: string;
  executorName: string;
}

export function launchVisual(opts: LaunchOpts): void {
  const { projectDir, claudePromptFile, geminiPromptFile, bridgePath, phase, architectName, executorName } = opts;

  killSession();

  const scriptDir = path.dirname(bridgePath);
  const claudeScript = path.join(scriptDir, `claude_p${phase}.sh`);
  const geminiScript = path.join(scriptDir, `gemini_p${phase}.sh`);

  writeRunScript(claudeScript, 'claude', claudePromptFile, bridgePath, `CLAUDE_P${phase}_DONE`, projectDir,
    `${architectName}  ·  Phase ${phase}`);
  writeRunScript(geminiScript, 'gemini', geminiPromptFile, bridgePath, `GEMINI_P${phase}_DONE`, projectDir,
    `${executorName}  ·  Phase ${phase}`);

  // Create session
  execSync(`tmux new-session -d -s ${SESSION} -x 240 -y 55`);

  // Split right for Gemini (50/50)
  execSync(`tmux split-window -h -t "${SESSION}:0.0"`);

  // Split bottom-left for bridge log (25% height)
  execSync(`tmux split-window -v -t "${SESSION}:0.0" -p 25`);

  // Pane 0 (top-left): Claude
  execSync(`tmux send-keys -t "${SESSION}:0.0" "bash '${claudeScript}'" Enter`);

  // Pane 1 (right): Gemini
  execSync(`tmux send-keys -t "${SESSION}:0.1" "bash '${geminiScript}'" Enter`);

  // Pane 2 (bottom-left): Bridge log
  execSync(`tmux send-keys -t "${SESSION}:0.2" "printf '\\033[36m=== Synapse Bridge Log ===\\033[0m\\n' && tail -f '${bridgePath}'" Enter`);

  // Open in a new Terminal.app window
  execSync(`osascript -e 'tell application "Terminal" to do script "tmux attach -t ${SESSION}"'`);
}

// Reuse the same session for a new phase (kill old panes, rerun scripts)
export function relaunchPhase(opts: LaunchOpts): void {
  const { projectDir, claudePromptFile, geminiPromptFile, bridgePath, phase, architectName, executorName } = opts;

  const scriptDir = path.dirname(bridgePath);
  const claudeScript = path.join(scriptDir, `claude_p${phase}.sh`);
  const geminiScript = path.join(scriptDir, `gemini_p${phase}.sh`);

  writeRunScript(claudeScript, 'claude', claudePromptFile, bridgePath, `CLAUDE_P${phase}_DONE`, projectDir,
    `${architectName}  ·  Phase ${phase}`);
  writeRunScript(geminiScript, 'gemini', geminiPromptFile, bridgePath, `GEMINI_P${phase}_DONE`, projectDir,
    `${executorName}  ·  Phase ${phase}`);

  // Send new commands to existing panes (CLIs have exited after Phase 1)
  try {
    execSync(`tmux send-keys -t "${SESSION}:0.0" "bash '${claudeScript}'" Enter`);
    execSync(`tmux send-keys -t "${SESSION}:0.1" "bash '${geminiScript}'" Enter`);
  } catch {
    // Session gone — relaunch fresh
    launchVisual(opts);
  }
}

export function waitForMarkers(bridgePath: string, markers: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const iv = setInterval(() => {
      try {
        const content = fs.readFileSync(bridgePath, 'utf8');
        if (markers.every(m => content.includes(m))) { clearInterval(iv); resolve(true); return; }
      } catch {}
      if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(false); }
    }, 1500);
  });
}
