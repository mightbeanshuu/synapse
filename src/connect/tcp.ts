import net from 'net';

const DEFAULT_PORT = 7891;

export class TCPHub {
  private server: net.Server;
  readonly port: number;
  private received = new Set<string>();
  private listeners = new Set<(marker: string) => void>();

  constructor(port = DEFAULT_PORT) {
    this.port = port;
    this.server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const marker = line.trim();
          if (marker) {
            this.received.add(marker);
            this.listeners.forEach(fn => fn(marker));
          }
        }
        socket.end();
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  stop(): void {
    this.server.close();
  }

  // Signal command to embed in run scripts (nc -N is BSD-compatible close-on-stdin-eof)
  signalCmd(marker: string, bridgePath: string): string {
    return `printf '${marker}\\n' | nc 127.0.0.1 ${this.port} 2>/dev/null || echo "${marker}" >> '${bridgePath}'`;
  }

  wait(
    markers: string[],
    timeoutMs: number,
    onProgress?: (found: string[], total: string[]) => void
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const found = new Set<string>(markers.filter(m => this.received.has(m)));
      if (onProgress && found.size > 0) onProgress([...found], markers);
      if (found.size === markers.length) { resolve(true); return; }

      const timer = setTimeout(() => {
        this.listeners.delete(handler);
        resolve(false);
      }, timeoutMs);

      const handler = (marker: string) => {
        if (markers.includes(marker)) {
          found.add(marker);
          onProgress?.([...found], markers);
          if (found.size === markers.length) {
            clearTimeout(timer);
            this.listeners.delete(handler);
            resolve(true);
          }
        }
      };

      this.listeners.add(handler);
    });
  }
}
