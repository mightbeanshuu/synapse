export type CLIId = 'claude' | 'gemini' | 'codex';

export interface CLIConfig {
  id: CLIId;
  binary: string;
  name: string;
  role: 'architect' | 'executor' | 'reviewer';
  preamble: string;
  color: string; // ANSI hex for display
}

export interface RolesConfig {
  cli1: Omit<CLIConfig, 'id' | 'role' | 'color'>;
  cli2: Omit<CLIConfig, 'id' | 'role' | 'color'>;
}

export interface RunResult {
  cli: string;
  output: string;
  durationMs: number;
  error?: string;
}

export interface ConnectionMethod {
  id: string;
  name: string;
  icon: string;
  description: string;
  implemented: boolean;
}

export interface Score {
  dimension: string;
  claude: number;
  gemini: number;
  advantage: string;
}

export interface Analysis {
  scores: Score[];
  architect: CLIId;
  executor: CLIId;
  reason: string;
}

export interface ActiveCLIs {
  configs: CLIConfig[];
  hasCodex: boolean;
}
