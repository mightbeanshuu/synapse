import fs from 'fs';
import path from 'path';

export class Bridge {
  private readonly filePath: string;

  constructor(sessionDir: string) {
    this.filePath = path.join(sessionDir, '_bridge.md');
    fs.writeFileSync(this.filePath, `# CLI Duo Bridge\n_Session started: ${new Date().toISOString()}_\n\n`);
  }

  append(section: string, content: string): void {
    const block = `## ${section}\n\n${content}\n\n---\n\n`;
    fs.appendFileSync(this.filePath, block);
  }

  read(): string {
    return fs.readFileSync(this.filePath, 'utf8');
  }

  get path(): string {
    return this.filePath;
  }
}
