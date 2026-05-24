import type { ConnectionMethod } from '../types';

export const CONNECTION_METHODS: ConnectionMethod[] = [
  {
    id: 'mcp',
    name: 'MCP  (Model Context Protocol)',
    icon: '⬡',
    description: 'Structured stdio MCP server per CLI · shared message bus · real-time collaboration',
    implemented: true,
    speedBar: '████████████████',
    speedLabel: 'BLAZING',
    badge: '⬡ MCP',
  },
  {
    id: 'named-pipe',
    name: 'Named Pipe  (FIFO)',
    icon: '⚡',
    description: 'OS mkfifo · zero-latency · resolves the instant CLI writes · sub-ms',
    implemented: true,
    speedBar: '████████████████',
    speedLabel: 'BLAZING',
    badge: '⚡ FASTEST',
  },
  {
    id: 'tcp-socket',
    name: 'TCP Socket Hub',
    icon: '🌐',
    description: 'localhost TCP server · event-driven · ~1 ms · no polling',
    implemented: true,
    speedBar: '██████████████░░',
    speedLabel: 'VERY FAST',
  },
  {
    id: 'parallel-streams',
    name: 'Parallel Streams',
    icon: '▶▶',
    description: 'Both CLIs run simultaneously · outputs streamed live',
    implemented: true,
    speedBar: '████████░░░░░░░░',
    speedLabel: 'FAST',
  },
  {
    id: 'pipeline',
    name: 'Pipeline',
    icon: '🔗',
    description: 'CLI1 output pipes directly into CLI2 stdin · single-pass chain',
    implemented: true,
    speedBar: '██████░░░░░░░░░░',
    speedLabel: 'FAST',
  },
  {
    id: 'file-bridge',
    name: 'File Bridge',
    icon: '📄',
    description: 'Shared markdown file · 2 s poll interval · zero dependencies',
    implemented: true,
    speedBar: '████░░░░░░░░░░░░',
    speedLabel: 'MEDIUM',
  },
  {
    id: 'sqlite-queue',
    name: 'SQLite Message Queue',
    icon: '🗄️',
    description: 'Persistent async queue · retry logic · durable across crashes',
    implemented: false,
    speedBar: '████████████░░░░',
    speedLabel: 'FAST',
  },
  {
    id: 'websocket',
    name: 'WebSocket Hub',
    icon: '🔌',
    description: 'Local WS server · real-time bidirectional · supports N CLIs',
    implemented: false,
    speedBar: '█████████████░░░',
    speedLabel: 'VERY FAST',
  },
];

// Speed priority order — first available wins
const SPEED_ORDER = [
  'named-pipe', 'tcp-socket', 'parallel-streams', 'pipeline',
  'file-bridge', 'sqlite-queue', 'websocket',
];

export function pickFastest(selected: string[]): string {
  for (const id of SPEED_ORDER) {
    const m = CONNECTION_METHODS.find(m => m.id === id);
    if (m?.implemented && selected.includes(id)) return id;
  }
  return 'parallel-streams';
}
