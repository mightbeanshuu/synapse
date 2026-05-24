import type { ConnectionMethod } from '../types';

export const CONNECTION_METHODS: ConnectionMethod[] = [
  {
    id: 'parallel-streams',
    name: 'Parallel Streams',
    icon: '⚡',
    description: 'Both CLIs run simultaneously · outputs streamed live · fastest',
    implemented: true,
  },
  {
    id: 'file-bridge',
    name: 'File Bridge',
    icon: '📄',
    description: 'Shared markdown file · turn-based · zero dependencies',
    implemented: true,
  },
  {
    id: 'pipeline',
    name: 'Pipeline',
    icon: '🔗',
    description: 'CLI1 output pipes directly into CLI2 stdin · single-pass chain',
    implemented: true,
  },
  {
    id: 'named-pipe',
    name: 'Named Pipe (FIFO)',
    icon: '🔀',
    description: 'OS-level mkfifo · lower latency than file I/O · bidirectional',
    implemented: false,
  },
  {
    id: 'tcp-socket',
    name: 'TCP Socket Hub',
    icon: '🌐',
    description: 'Orchestrator routes via localhost TCP · works across machines via SSH',
    implemented: false,
  },
  {
    id: 'sqlite-queue',
    name: 'SQLite Message Queue',
    icon: '🗄️',
    description: 'Persistent async queue · retry logic · durable across crashes',
    implemented: false,
  },
  {
    id: 'websocket',
    name: 'WebSocket Hub',
    icon: '🔌',
    description: 'Local WS server · real-time bidirectional · supports N CLIs',
    implemented: false,
  },
];
