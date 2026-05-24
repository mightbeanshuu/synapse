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
