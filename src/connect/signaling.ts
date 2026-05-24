import fs from 'fs';
import { setupFIFOs, cleanupFIFOs, fifoSignalCmd, waitFIFO } from './fifo';
import { TCPHub } from './tcp';

export interface SignalingChannel {
  signalCmdFor(marker: string): string;
  waitAll(
    markers: string[],
    timeoutMs: number,
    onProgress?: (found: string[], total: string[]) => void
  ): Promise<boolean>;
  teardown(): void;
}

// ── FIFO channel ─────────────────────────────────────────────────────────────
class FIFOChannel implements SignalingChannel {
  constructor(private markers: string[]) {
    setupFIFOs(markers);
  }

  signalCmdFor(marker: string): string {
    return fifoSignalCmd(marker);
  }

  waitAll(
    markers: string[],
    timeoutMs: number,
    onProgress?: (found: string[], total: string[]) => void
  ): Promise<boolean> {
    return waitFIFO(markers, timeoutMs, onProgress);
  }

  teardown(): void {
    cleanupFIFOs(this.markers);
  }
}

// ── TCP channel ───────────────────────────────────────────────────────────────
class TCPChannel implements SignalingChannel {
  private hub: TCPHub;

  constructor(private bridgePath: string) {
    this.hub = new TCPHub();
  }

  async start(): Promise<void> {
    await this.hub.start();
  }

  signalCmdFor(marker: string): string {
    return this.hub.signalCmd(marker, this.bridgePath);
  }

  waitAll(
    markers: string[],
    timeoutMs: number,
    onProgress?: (found: string[], total: string[]) => void
  ): Promise<boolean> {
    return this.hub.wait(markers, timeoutMs, onProgress);
  }

  teardown(): void {
    this.hub.stop();
  }
}

// ── Bridge (file-poll) channel ────────────────────────────────────────────────
class BridgeChannel implements SignalingChannel {
  constructor(private bridgePath: string) {}

  signalCmdFor(marker: string): string {
    return `echo "${marker}" >> '${this.bridgePath}'`;
  }

  waitAll(
    markers: string[],
    timeoutMs: number,
    onProgress?: (found: string[], total: string[]) => void
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const found = new Set<string>();

      const iv = setInterval(() => {
        try {
          const content = fs.existsSync(this.bridgePath)
            ? fs.readFileSync(this.bridgePath, 'utf8')
            : '';
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

  teardown(): void {}
}

// ── Factory ───────────────────────────────────────────────────────────────────
export async function createSignalingChannel(
  method: string,
  markers: string[],
  bridgePath: string
): Promise<SignalingChannel> {
  if (method === 'named-pipe') {
    return new FIFOChannel(markers);
  }

  if (method === 'tcp-socket') {
    const ch = new TCPChannel(bridgePath);
    await ch.start();
    return ch;
  }

  return new BridgeChannel(bridgePath);
}
