import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CLIId } from '../types';

const SERVER_TS = path.join(__dirname, 'server.ts');
const TSX_BIN   = path.join(__dirname, '../../node_modules/.bin/tsx');

function tsxCmd(): string {
  return fs.existsSync(TSX_BIN) ? TSX_BIN : 'tsx';
}

// Unique server name per session avoids conflicts with concurrent runs
function serverName(sessionId: string): string {
  return `synapse-${sessionId}`;
}

// ── Claude: write .mcp.json to project dir ────────────────────────────────────
function registerClaude(name: string, stateDir: string, projectDir: string): void {
  const mcpPath = path.join(projectDir, '.mcp.json');
  let existing: Record<string, unknown> = {};
  let backup: string | null = null;
  if (fs.existsSync(mcpPath)) {
    backup = fs.readFileSync(mcpPath, 'utf8');
    try { existing = JSON.parse(backup); } catch {}
  }
  const servers = (existing.mcpServers as Record<string, unknown>) ?? {};
  servers[name] = {
    command: tsxCmd(),
    args: [SERVER_TS, `--agent=claude`, `--state-dir=${stateDir}`],
  };
  existing.mcpServers = servers;
  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2));
  if (backup !== null) {
    fs.writeFileSync(mcpPath + '.synapse-bak', backup);
  }
}

function cleanupClaude(name: string, projectDir: string): void {
  const mcpPath = path.join(projectDir, '.mcp.json');
  const bakPath = mcpPath + '.synapse-bak';
  if (fs.existsSync(bakPath)) {
    // Restore original
    fs.renameSync(bakPath, mcpPath);
  } else if (fs.existsSync(mcpPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      const servers = content.mcpServers ?? {};
      delete servers[name];
      if (Object.keys(servers).length === 0) {
        fs.unlinkSync(mcpPath);
      } else {
        content.mcpServers = servers;
        fs.writeFileSync(mcpPath, JSON.stringify(content, null, 2));
      }
    } catch {}
  }
}

// ── Gemini: gemini mcp add (project scope = .gemini/settings.json) ────────────
function registerGemini(name: string, stateDir: string): void {
  try {
    execSync(
      `gemini mcp add ${name} -s project -- ${tsxCmd()} ${SERVER_TS} --agent=gemini --state-dir=${stateDir}`,
      { stdio: 'ignore', timeout: 10_000 }
    );
  } catch {
    // Non-fatal — Gemini will work without MCP, just won't collaborate
  }
}

function cleanupGemini(name: string, projectDir: string): void {
  try {
    // Project-scope writes to .gemini/settings.json — just delete the entry
    const settingsPath = path.join(projectDir, '.gemini', 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (content.mcpServers) {
      delete content.mcpServers[name];
      if (Object.keys(content.mcpServers).length === 0) delete content.mcpServers;
      if (Object.keys(content).length === 0) {
        fs.unlinkSync(settingsPath);
      } else {
        fs.writeFileSync(settingsPath, JSON.stringify(content, null, 2));
      }
    }
  } catch {}
}

// ── Codex: codex mcp add ──────────────────────────────────────────────────────
function registerCodex(name: string, stateDir: string): void {
  try {
    execSync(
      `codex mcp add ${name} -- ${tsxCmd()} ${SERVER_TS} --agent=codex --state-dir=${stateDir}`,
      { stdio: 'ignore', timeout: 10_000 }
    );
  } catch {}
}

function cleanupCodex(name: string): void {
  try {
    execSync(`codex mcp remove ${name}`, { stdio: 'ignore', timeout: 5_000 });
  } catch {}
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function registerMCP(
  sessionId: string,
  stateDir: string,
  projectDir: string,
  cliIds: CLIId[]
): string {
  const name = serverName(sessionId);
  if (cliIds.includes('claude'))  registerClaude(name, stateDir, projectDir);
  if (cliIds.includes('gemini'))  registerGemini(name, stateDir);
  if (cliIds.includes('codex'))   registerCodex(name, stateDir);
  return name;
}

export function cleanupMCP(
  sessionId: string,
  projectDir: string,
  cliIds: CLIId[]
): void {
  const name = serverName(sessionId);
  if (cliIds.includes('claude'))  cleanupClaude(name, projectDir);
  if (cliIds.includes('gemini'))  cleanupGemini(name, projectDir);
  if (cliIds.includes('codex'))   cleanupCodex(name);
}
