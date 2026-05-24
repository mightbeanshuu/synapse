export interface CLIConfig {
  binary: string;
  name: string;
  preamble: string;
}

export interface RolesConfig {
  cli1: CLIConfig;
  cli2: CLIConfig;
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
  architect: 'claude' | 'gemini';
  executor: 'claude' | 'gemini';
  reason: string;
}

export interface AssignedRoles {
  architect: CLIConfig;
  executor: CLIConfig;
  reason: string;
}
