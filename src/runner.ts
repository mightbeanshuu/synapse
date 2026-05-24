import { spawn } from 'child_process';
import type { RunResult } from './types';

const TIMEOUT_MS = 5 * 60 * 1000;

export function runCLI(
  binary: string,
  name: string,
  prompt: string,
  cwd: string
): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';

    // Claude Code: prompt is a positional arg, --print enables non-interactive mode
    // Gemini:      -p/--prompt takes the prompt as its value
    const args =
      binary === 'claude'
        ? ['--print', '--dangerously-skip-permissions', prompt]
        : ['-p', prompt, '--yolo'];

    const proc = spawn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    proc.stdout.on('data', (d: Buffer) => {
      process.stdout.write(`[${name}] ${d}`);
      stdout += d.toString();
    });

    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        cli: name,
        output: stdout.trim(),
        durationMs: Date.now() - start,
        error: 'Timed out after 5 minutes',
      });
    }, TIMEOUT_MS);

    proc.on('close', () => {
      clearTimeout(timer);
      resolve({
        cli: name,
        output: stdout.trim(),
        durationMs: Date.now() - start,
        error: stderr.trim() || undefined,
      });
    });
  });
}
