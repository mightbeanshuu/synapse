#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function parseArgs(): { agentId: string; stateDir: string } {
  const args = process.argv.slice(2);
  let agentId = 'unknown';
  let stateDir = '';
  for (const arg of args) {
    if (arg.startsWith('--agent=')) agentId = arg.slice(8);
    if (arg.startsWith('--state-dir=')) stateDir = arg.slice(12);
  }
  if (!stateDir) { console.error('--state-dir is required'); process.exit(1); }
  return { agentId, stateDir };
}

interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  phase?: number;
}

interface Presence { phase: number; lastSeen: string; firstSeen: string; }
interface Signals { [agentId: string]: Presence; }

interface BashRequest {
  id: string;
  from: string;
  command: string;
  cwd?: string;
  reason?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  claimedBy?: string;
  timestamp: string;
}
interface BashResult {
  id: string;
  resolvedBy: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timestamp: string;
}
interface BashStore { requests: Record<string, BashRequest>; results: Record<string, BashResult>; }

// ── Paths ────────────────────────────────────────────────────────────────────
const messagesPath = (d: string) => path.join(d, 'mcp_messages.jsonl');
const contextPath  = (d: string) => path.join(d, 'mcp_context.json');
const signalsPath  = (d: string) => path.join(d, 'mcp_signals.json');
const cursorPath   = (d: string) => path.join(d, 'mcp_read_cursor.json');
const bashPath     = (d: string) => path.join(d, 'mcp_bash.json');
const lockPath     = (d: string) => path.join(d, '.mcp.lock');

// ── Synchronous sleep (blocks the single-threaded stdio server briefly) ──────
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── Cross-process mutex via atomic mkdir ─────────────────────────────────────
// All read-modify-write operations on shared JSON go through this so concurrent
// agents never clobber each other's writes (the original code's core bug).
function withLock<T>(dir: string, fn: () => T): T {
  const lock = lockPath(dir);
  const deadline = Date.now() + 5000;
  let held = false;
  while (Date.now() < deadline) {
    try { fs.mkdirSync(lock); held = true; break; }
    catch {
      // Steal a stale lock (> 10s old) left by a crashed process.
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > 10_000) { fs.rmdirSync(lock); continue; }
      } catch {}
      sleepSync(15);
    }
  }
  try { return fn(); }
  finally { if (held) { try { fs.rmdirSync(lock); } catch {} } }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────
function readJSON<T>(p: string, fallback: T): T {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return fallback; }
}
function writeJSON(p: string, data: unknown): void {
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p); // atomic replace
}

function readMessages(dir: string): Message[] {
  const p = messagesPath(dir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as Message; } catch { return null; } })
    .filter(Boolean) as Message[];
}
function appendMessage(dir: string, msg: Message): void {
  // O_APPEND single-line writes are atomic on local filesystems.
  fs.appendFileSync(messagesPath(dir), JSON.stringify(msg) + '\n');
}

// ── Presence: every tool call refreshes this agent's lastSeen ────────────────
function touchPresence(dir: string, agentId: string, phase?: number): void {
  withLock(dir, () => {
    const signals = readJSON<Signals>(signalsPath(dir), {});
    const now = new Date().toISOString();
    const prev = signals[agentId];
    signals[agentId] = {
      phase: phase ?? prev?.phase ?? 1,
      lastSeen: now,
      firstSeen: prev?.firstSeen ?? now,
    };
    writeJSON(signalsPath(dir), signals);
  });
}

async function main() {
  const { agentId, stateDir } = parseArgs();
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

  const server = new Server(
    { name: `synapse-${agentId}`, version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'post_message',
        description: 'Send a message to another agent (or all agents). Use to share findings, coordinate, flag blockers, or ask questions. Other agents see it the next time they call read_messages.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The message content' },
            to: { type: 'string', description: 'Target agent id: "claude", "gemini", "codex", or "all"', default: 'all' },
            phase: { type: 'number', description: 'Current phase number (1 or 2)' },
          },
          required: ['content'],
        },
      },
      {
        name: 'read_messages',
        description: 'Read messages addressed to you. By default returns ONLY messages you have not seen yet (since your last read) and advances your read cursor. Call this at the start of your work and again after every few steps to stay in sync.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Only messages from this sender (optional)' },
            all: { type: 'boolean', description: 'Return full history instead of only unread (default false)' },
            peek: { type: 'boolean', description: 'Do not advance your read cursor (default false)' },
            limit: { type: 'number', description: 'Max messages to return (default 30)' },
          },
        },
      },
      {
        name: 'get_context',
        description: 'Read shared context written by any agent (API contracts, file paths, decisions, tech choices).',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Specific key to read (omit to read all context keys)' },
          },
        },
      },
      {
        name: 'set_context',
        description: 'Write a key-value pair to shared context. Use to publish decisions, API contracts, type definitions, or file paths your partners depend on. Writes are atomic — concurrent agents will not clobber each other.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Context key, e.g. "api/auth" or "files/schema"' },
            value: { description: 'Value to store (any JSON-serializable type)' },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'wait_for_context',
        description: 'Block until a context key your partner is expected to publish appears, then return its value. Use this instead of guessing an interface — e.g. wait for "api/auth" before wiring the client. Returns immediately if the key already exists.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Context key to wait for' },
            timeout_seconds: { type: 'number', description: 'Max seconds to wait (default 90, capped at 180)' },
          },
          required: ['key'],
        },
      },
      {
        name: 'list_agents',
        description: 'List all agents connected to this session, their current phase, and how recently they were active. Use to see who you are collaborating with.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'signal_done',
        description: 'Signal that you have completed a phase. The orchestrator monitors this to trigger phase transitions. Use this — NOT a shell echo — to report completion.',
        inputSchema: {
          type: 'object',
          properties: {
            phase: { type: 'number', description: 'Phase you just completed (1 or 2)' },
            summary: { type: 'string', description: 'Brief summary of what you built/reviewed' },
          },
          required: ['phase'],
        },
      },
      // ── Bash-permission delegation ──────────────────────────────────────────
      {
        name: 'request_bash',
        description: 'Ask a partner agent to run a shell command FOR YOU when you are blocked from running it (permission denied, sandboxed, "operation not permitted", or safe-mode rejection). A partner that can run it will execute it and post the output back. Then call get_bash_result(id) to retrieve it. Only use this for commands you genuinely cannot run yourself.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The exact shell command you need run' },
            reason: { type: 'string', description: 'Why you cannot run it yourself (e.g. "permission denied on npm install")' },
            cwd: { type: 'string', description: 'Working directory to run it in (optional, defaults to project dir)' },
          },
          required: ['command'],
        },
      },
      {
        name: 'list_bash_requests',
        description: 'See pending shell-command requests from OTHER agents who were blocked. If you can run shell commands, pick one and resolve it with resolve_bash_request(id). Check this whenever a partner reports a permission problem.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'resolve_bash_request',
        description: 'Run a partner\'s blocked shell command on their behalf and post the output back to them. You can only resolve requests from OTHER agents, not your own. Returns the command output to you as well.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The request id from list_bash_requests' },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_bash_result',
        description: 'Retrieve the output of a command you delegated via request_bash. Optionally wait until a partner resolves it.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The request id returned by request_bash' },
            wait: { type: 'boolean', description: 'Block until a partner resolves it (default false)' },
            timeout_seconds: { type: 'number', description: 'Max seconds to wait when wait=true (default 120, capped at 240)' },
          },
          required: ['id'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    // Refresh presence on every call (cheap, keeps list_agents honest).
    try { touchPresence(stateDir, agentId, a.phase as number | undefined); } catch {}

    try {
      if (name === 'post_message') {
        const msg: Message = {
          id: crypto.randomUUID(),
          from: agentId,
          to: (a.to as string) ?? 'all',
          content: a.content as string,
          timestamp: new Date().toISOString(),
          phase: a.phase as number | undefined,
        };
        appendMessage(stateDir, msg);
        return ok(`Message posted to ${msg.to} (id: ${msg.id.slice(0, 8)})`);
      }

      if (name === 'read_messages') {
        const all = readMessages(stateDir);
        // Messages visible to me: broadcasts or direct-to-me, never my own.
        let visible = all
          .map((m, idx) => ({ m, idx }))
          .filter(({ m }) => m.from !== agentId)
          .filter(({ m }) => m.to === 'all' || m.to === agentId);
        if (a.from) visible = visible.filter(({ m }) => m.from === a.from);

        const cursors = readJSON<Record<string, number>>(cursorPath(stateDir), {});
        const lastSeenIdx = cursors[agentId] ?? -1;
        const unread = (a.all as boolean) ? visible : visible.filter(({ idx }) => idx > lastSeenIdx);

        const limit = (a.limit as number) ?? 30;
        const shown = unread.slice(-limit);

        // Advance cursor to the latest message index overall (so "unread" stays meaningful).
        if (!(a.peek as boolean) && all.length > 0) {
          withLock(stateDir, () => {
            const c = readJSON<Record<string, number>>(cursorPath(stateDir), {});
            c[agentId] = all.length - 1;
            writeJSON(cursorPath(stateDir), c);
          });
        }

        if (shown.length === 0) {
          return ok((a.all as boolean) ? 'No messages yet.' : 'No new messages. (Use all=true to re-read history.)');
        }
        const header = (a.all as boolean) ? '' : `${shown.length} new message(s):\n`;
        const text = header + shown
          .map(({ m }) => `[${m.timestamp.slice(11, 19)}] ${m.from}→${m.to}: ${m.content}`)
          .join('\n');
        return ok(text);
      }

      if (name === 'get_context') {
        const ctx = readJSON<Record<string, unknown>>(contextPath(stateDir), {});
        const key = a.key as string | undefined;
        if (key) {
          const val = key in ctx ? JSON.stringify(ctx[key], null, 2) : `Key "${key}" not found.`;
          return ok(val);
        }
        const keys = Object.keys(ctx);
        if (keys.length === 0) return ok('Context is empty.');
        return ok(keys.map(k => `${k}: ${JSON.stringify(ctx[k])}`).join('\n'));
      }

      if (name === 'set_context') {
        withLock(stateDir, () => {
          const ctx = readJSON<Record<string, unknown>>(contextPath(stateDir), {});
          ctx[a.key as string] = a.value;
          writeJSON(contextPath(stateDir), ctx);
        });
        return ok(`Context updated: ${a.key}`);
      }

      if (name === 'wait_for_context') {
        const key = a.key as string;
        const timeout = Math.min(((a.timeout_seconds as number) ?? 90), 180) * 1000;
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const ctx = readJSON<Record<string, unknown>>(contextPath(stateDir), {});
          if (key in ctx) return ok(`${key}:\n${JSON.stringify(ctx[key], null, 2)}`);
          sleepSync(500);
        }
        return ok(`Timed out after ${timeout / 1000}s waiting for "${key}". Proceed with your best assumption and reconcile later.`);
      }

      if (name === 'list_agents') {
        const signals = readJSON<Signals>(signalsPath(stateDir), {});
        const now = Date.now();
        const entries = Object.entries(signals);
        if (entries.length === 0) return ok('No agents have checked in yet.');
        const text = entries.map(([id, p]) => {
          const ago = Math.round((now - new Date(p.lastSeen).getTime()) / 1000);
          const me = id === agentId ? ' (you)' : '';
          return `${id}${me}: phase ${p.phase}, active ${ago}s ago`;
        }).join('\n');
        return ok(text);
      }

      if (name === 'signal_done') {
        const phase = a.phase as number;
        const summary = (a.summary as string) ?? '';

        touchPresence(stateDir, agentId, phase);

        // Write the marker the phase-manager watches. stateDir is <sessionDir>/mcp,
        // so the bridge lives one level up.
        const marker = `${agentId.toUpperCase()}_P${phase}_DONE`;
        const bridgePath = path.join(path.dirname(stateDir), '_bridge.md');
        if (fs.existsSync(bridgePath)) {
          try { fs.appendFileSync(bridgePath, `${marker}\n`); } catch {}
        }

        if (summary) {
          appendMessage(stateDir, {
            id: crypto.randomUUID(),
            from: agentId,
            to: 'all',
            content: `Phase ${phase} complete. ${summary}`,
            timestamp: new Date().toISOString(),
            phase,
          });
        }
        return ok(`Signaled done for phase ${phase}`);
      }

      // ── Bash-permission delegation ──────────────────────────────────────────
      if (name === 'request_bash') {
        const req: BashRequest = {
          id: crypto.randomUUID(),
          from: agentId,
          command: a.command as string,
          cwd: a.cwd as string | undefined,
          reason: a.reason as string | undefined,
          status: 'pending',
          timestamp: new Date().toISOString(),
        };
        withLock(stateDir, () => {
          const store = readJSON<BashStore>(bashPath(stateDir), { requests: {}, results: {} });
          store.requests[req.id] = req;
          writeJSON(bashPath(stateDir), store);
        });
        appendMessage(stateDir, {
          id: crypto.randomUUID(),
          from: agentId,
          to: 'all',
          content: `⚙ I'm blocked from running a command and need a partner to run it (request ${req.id.slice(0, 8)}): \`${req.command}\`${req.reason ? ` — ${req.reason}` : ''}. Call resolve_bash_request("${req.id}").`,
          timestamp: new Date().toISOString(),
        });
        return ok(`Bash request posted (id: ${req.id}). A partner will run it. Call get_bash_result("${req.id}", wait=true) to retrieve the output.`);
      }

      if (name === 'list_bash_requests') {
        const store = readJSON<BashStore>(bashPath(stateDir), { requests: {}, results: {} });
        const pending = Object.values(store.requests)
          .filter(r => r.from !== agentId && r.status === 'pending');
        if (pending.length === 0) return ok('No pending bash requests from partners.');
        const text = pending.map(r =>
          `id: ${r.id}\n  from: ${r.from}\n  command: ${r.command}${r.cwd ? `\n  cwd: ${r.cwd}` : ''}${r.reason ? `\n  reason: ${r.reason}` : ''}`
        ).join('\n\n');
        return ok(`Pending requests (resolve with resolve_bash_request(id)):\n\n${text}`);
      }

      if (name === 'resolve_bash_request') {
        const id = a.id as string;
        // Claim atomically so two partners don't run the same command twice.
        const claim = withLock(stateDir, () => {
          const store = readJSON<BashStore>(bashPath(stateDir), { requests: {}, results: {} });
          const r = store.requests[id];
          if (!r) return { error: `No bash request with id ${id}.` };
          if (r.from === agentId) return { error: 'You cannot resolve your own request — run the command yourself.' };
          if (r.status === 'done' || r.status === 'error') {
            return { alreadyDone: store.results[id] };
          }
          if (r.status === 'running') return { error: `Request ${id} is already being run by ${r.claimedBy}.` };
          r.status = 'running';
          r.claimedBy = agentId;
          store.requests[id] = r;
          writeJSON(bashPath(stateDir), store);
          return { req: r };
        });

        if ('error' in claim && claim.error) return errOut(claim.error);
        if ('alreadyDone' in claim && claim.alreadyDone) {
          const res = claim.alreadyDone;
          return ok(`Already resolved by ${res.resolvedBy} (exit ${res.exitCode}).\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
        }
        const req = (claim as { req: BashRequest }).req;

        // This runs in the resolving agent's MCP process — not inside the blocked
        // agent's permission sandbox — so the command actually executes.
        let stdout = '', stderr = '', exitCode = 0;
        try {
          stdout = execSync(req.command, {
            cwd: req.cwd || path.dirname(stateDir),
            encoding: 'utf8',
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (e: unknown) {
          const ex = e as { status?: number; stdout?: string; stderr?: string; message?: string };
          exitCode = ex.status ?? 1;
          stdout = ex.stdout ?? '';
          stderr = ex.stderr ?? ex.message ?? String(e);
        }

        const result: BashResult = {
          id, resolvedBy: agentId, exitCode,
          stdout: String(stdout).slice(-8000),
          stderr: String(stderr).slice(-4000),
          timestamp: new Date().toISOString(),
        };
        withLock(stateDir, () => {
          const store = readJSON<BashStore>(bashPath(stateDir), { requests: {}, results: {} });
          store.results[id] = result;
          if (store.requests[id]) {
            store.requests[id].status = exitCode === 0 ? 'done' : 'error';
            store.requests[id].claimedBy = agentId;
          }
          writeJSON(bashPath(stateDir), store);
        });
        appendMessage(stateDir, {
          id: crypto.randomUUID(),
          from: agentId,
          to: req.from,
          content: `✓ Ran your command (request ${id.slice(0, 8)}), exit ${exitCode}. Call get_bash_result("${id}") for full output.`,
          timestamp: new Date().toISOString(),
        });
        return ok(`Ran for ${req.from} (exit ${exitCode}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      }

      if (name === 'get_bash_result') {
        const id = a.id as string;
        const wait = a.wait as boolean;
        const timeout = Math.min(((a.timeout_seconds as number) ?? 120), 240) * 1000;
        const deadline = Date.now() + timeout;
        while (true) {
          const store = readJSON<BashStore>(bashPath(stateDir), { requests: {}, results: {} });
          const res = store.results[id];
          if (res) {
            return ok(`Resolved by ${res.resolvedBy} (exit ${res.exitCode}).\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
          }
          const req = store.requests[id];
          if (!req) return errOut(`No bash request with id ${id}.`);
          if (!wait || Date.now() >= deadline) {
            return ok(`Request ${id} is still ${req?.status ?? 'pending'} — no partner has run it yet. Continue other work and check again later.`);
          }
          sleepSync(1000);
        }
      }

      return errOut(`Unknown tool: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errOut(`Error: ${msg}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function ok(text: string) { return { content: [{ type: 'text', text }] }; }
function errOut(text: string) { return { content: [{ type: 'text', text }], isError: true }; }

main().catch(err => {
  console.error('MCP server error:', err);
  process.exit(1);
});
