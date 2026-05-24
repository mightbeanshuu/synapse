import { execSync, spawn } from 'child_process';
import fs from 'fs';

const FIFO_DIR = '/tmp';

function fifoPath(marker: string): string {
  return `${FIFO_DIR}/syn_${marker}.fifo`;
}

export function setupFIFOs(markers: string[]): void {
  for (const m of markers) {
    const p = fifoPath(m);
    try { execSync(`rm -f '${p}'`, { stdio: 'ignore' }); } catch {}
    execSync(`mkfifo '${p}'`);
  }
}

export function cleanupFIFOs(markers: string[]): void {
  for (const m of markers) {
    try { execSync(`rm -f '${fifoPath(m)}'`, { stdio: 'ignore' }); } catch {}
  }
}

// Signal command to embed in run scripts
export function fifoSignalCmd(marker: string): string {
  return `echo "${marker}" > '${fifoPath(marker)}'`;
}

// Read one marker from its FIFO — resolves immediately when the writer writes
function readFIFO(marker: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const p = fifoPath(marker);
    const proc = spawn('cat', [p], { stdio: ['ignore', 'pipe', 'ignore'] });
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; proc.kill(); resolve(null); }
    }, timeoutMs);

    proc.stdout.once('data', () => {
      if (!done) { done = true; clearTimeout(timer); proc.kill(); resolve(marker); }
    });

    proc.on('close', () => {
      if (!done) { done = true; clearTimeout(timer); resolve(null); }
    });
  });
}

export async function waitFIFO(
  markers: string[],
  timeoutMs: number,
  onProgress?: (found: string[], total: string[]) => void
): Promise<boolean> {
  const found: string[] = [];

  await Promise.all(
    markers.map(m =>
      readFIFO(m, timeoutMs).then(result => {
        if (result) {
          found.push(result);
          onProgress?.(found, markers);
        }
      })
    )
  );

  return found.length === markers.length;
}
