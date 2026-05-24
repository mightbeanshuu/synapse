#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types';
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

interface Signals {
  [agentId: string]: { phase: number; timestamp: string };
}

function messagesPath(dir: string) { return path.join(dir, 'mcp_messages.jsonl'); }
function contextPath(dir: string)  { return path.join(dir, 'mcp_context.json'); }
function signalsPath(dir: string)  { return path.join(dir, 'mcp_signals.json'); }

function readMessages(dir: string): Message[] {
  const p = messagesPath(dir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as Message; } catch { return null; } })
    .filter(Boolean) as Message[];
}

function appendMessage(dir: string, msg: Message): void {
  fs.appendFileSync(messagesPath(dir), JSON.stringify(msg) + '\n');
}

function readContext(dir: string): Record<string, unknown> {
  const p = contextPath(dir);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeContext(dir: string, ctx: Record<string, unknown>): void {
  fs.writeFileSync(contextPath(dir), JSON.stringify(ctx, null, 2));
}

function readSignals(dir: string): Signals {
  const p = signalsPath(dir);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeSignals(dir: string, signals: Signals): void {
  fs.writeFileSync(signalsPath(dir), JSON.stringify(signals, null, 2));
}

async function main() {
  const { agentId, stateDir } = parseArgs();

  // Ensure state dir exists
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

  const server = new Server(
    { name: `synapse-${agentId}`, version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'post_message',
        description: 'Send a message to another agent (or all agents). Use to share findings, coordinate, or ask questions.',
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
        description: 'Read messages from other agents. Filter by sender or recipient.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Filter by sender agent id (optional)' },
            since_id: { type: 'string', description: 'Only return messages after this message id (optional)' },
            limit: { type: 'number', description: 'Max messages to return (default 20)' },
          },
        },
      },
      {
        name: 'get_context',
        description: 'Read shared context. Use to see what other agents have recorded (e.g. API contracts, file paths, decisions).',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Specific key to read (omit to read all context)' },
          },
        },
      },
      {
        name: 'set_context',
        description: 'Write a key-value pair to shared context. Use to record decisions, API contracts, or shared state.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Context key' },
            value: { description: 'Value to store (any JSON-serializable type)' },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'signal_done',
        description: 'Signal that you have completed a phase. The orchestrator monitors this to trigger phase transitions.',
        inputSchema: {
          type: 'object',
          properties: {
            phase: { type: 'number', description: 'Phase you just completed (1 or 2)' },
            summary: { type: 'string', description: 'Brief summary of what you built/reviewed' },
          },
          required: ['phase'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

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
        return { content: [{ type: 'text', text: `Message posted (id: ${msg.id})` }] };
      }

      if (name === 'read_messages') {
        let msgs = readMessages(stateDir)
          .filter(m => m.from !== agentId)  // don't show own messages
          .filter(m => m.to === 'all' || m.to === agentId || m.from === (a.from as string | undefined));
        if (a.from) msgs = msgs.filter(m => m.from === a.from);
        if (a.since_id) {
          const idx = msgs.findIndex(m => m.id === a.since_id);
          if (idx >= 0) msgs = msgs.slice(idx + 1);
        }
        const limit = (a.limit as number) ?? 20;
        msgs = msgs.slice(-limit);
        const text = msgs.length === 0
          ? 'No messages yet.'
          : msgs.map(m => `[${m.timestamp.slice(11, 19)}] ${m.from}→${m.to}: ${m.content}`).join('\n');
        return { content: [{ type: 'text', text }] };
      }

      if (name === 'get_context') {
        const ctx = readContext(stateDir);
        const key = a.key as string | undefined;
        if (key) {
          const val = key in ctx ? JSON.stringify(ctx[key], null, 2) : `Key "${key}" not found.`;
          return { content: [{ type: 'text', text: val }] };
        }
        const text = Object.keys(ctx).length === 0
          ? 'Context is empty.'
          : Object.entries(ctx).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
        return { content: [{ type: 'text', text }] };
      }

      if (name === 'set_context') {
        const ctx = readContext(stateDir);
        ctx[a.key as string] = a.value;
        writeContext(stateDir, ctx);
        return { content: [{ type: 'text', text: `Context updated: ${a.key}` }] };
      }

      if (name === 'signal_done') {
        const phase = a.phase as number;
        const summary = (a.summary as string) ?? '';

        // Write to shared signals
        const signals = readSignals(stateDir);
        signals[agentId] = { phase, timestamp: new Date().toISOString() };
        writeSignals(stateDir, signals);

        // Also write to the bridge file that phase-manager watches
        const marker = `${agentId.toUpperCase()}_P${phase}_DONE`;
        const bridgeFiles = fs.readdirSync(path.dirname(stateDir))
          .map(f => path.join(path.dirname(stateDir), f))
          .filter(f => f.endsWith('_bridge.md'));
        // Walk up one more level if needed
        const sessionParent = path.dirname(stateDir);
        const bridgePath = path.join(sessionParent, '_bridge.md');
        if (fs.existsSync(bridgePath)) {
          fs.appendFileSync(bridgePath, `${marker}\n`);
        }

        // Post summary as message too
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

        return { content: [{ type: 'text', text: `Signaled done for phase ${phase}` }] };
      }

      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('MCP server error:', err);
  process.exit(1);
});
