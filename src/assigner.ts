import type { Analysis, AssignedRoles, CLIConfig } from './types';

const CLAUDE_CONFIG: CLIConfig = {
  binary: 'claude',
  name: 'Claude (Architect)',
  preamble:
    'You are the LOGIC & ARCHITECTURE lead on this project. Your job:\n' +
    '- Design the system and its components\n' +
    '- Define data structures and core APIs\n' +
    '- Write the core logic (not boilerplate)\n' +
    '- Identify edge cases and security concerns\n\n' +
    'Output ONLY structured markdown with these sections:\n' +
    '## System Design\n## Core Logic\n## Data Structures\n## Edge Cases & Security\n\n' +
    'Be terse and concrete. No fluff.',
};

const GEMINI_CONFIG: CLIConfig = {
  binary: 'gemini',
  name: 'Gemini (Executor)',
  preamble:
    'You are the EXECUTION & BUILD lead on this project. Your job:\n' +
    '- Define the file/folder structure\n' +
    '- Write complete, runnable implementation code\n' +
    '- Add test cases\n' +
    '- Write setup instructions\n\n' +
    'Output ONLY structured markdown with these sections:\n' +
    '## File Structure\n## Implementation\n## Tests\n## Setup\n\n' +
    'Write complete code, not pseudocode. Be terse.',
};

const CLAUDE_ARCH_CONFIG: CLIConfig = {
  ...CLAUDE_CONFIG,
  name: 'Claude (Architect)',
  preamble: CLAUDE_CONFIG.preamble,
};

const GEMINI_EXEC_CONFIG: CLIConfig = {
  ...GEMINI_CONFIG,
  name: 'Gemini (Executor)',
  preamble: GEMINI_CONFIG.preamble,
};

const CLAUDE_EXEC_CONFIG: CLIConfig = {
  binary: 'claude',
  name: 'Claude (Executor)',
  preamble:
    'You are the EXECUTION & BUILD lead on this project. Your job:\n' +
    '- Define the file/folder structure\n' +
    '- Write complete, runnable implementation code\n' +
    '- Add comprehensive test cases\n' +
    '- Write setup and deployment instructions\n\n' +
    'Output ONLY structured markdown with these sections:\n' +
    '## File Structure\n## Implementation\n## Tests\n## Setup\n\n' +
    'Write complete, production-quality code. Be terse.',
};

const GEMINI_ARCH_CONFIG: CLIConfig = {
  binary: 'gemini',
  name: 'Gemini (Architect)',
  preamble:
    'You are the LOGIC & ARCHITECTURE lead on this project. Your job:\n' +
    '- Design the system and its components\n' +
    '- Define data structures and core APIs\n' +
    '- Write the core logic (not boilerplate)\n' +
    '- Identify edge cases and security concerns\n\n' +
    'Output ONLY structured markdown with these sections:\n' +
    '## System Design\n## Core Logic\n## Data Structures\n## Edge Cases & Security\n\n' +
    'Be terse and concrete. No fluff.',
};

export function assignRoles(analysis: Analysis): AssignedRoles {
  const architectConfig = analysis.architect === 'claude' ? CLAUDE_ARCH_CONFIG : GEMINI_ARCH_CONFIG;
  const executorConfig  = analysis.executor  === 'claude' ? CLAUDE_EXEC_CONFIG : GEMINI_EXEC_CONFIG;

  return {
    architect: architectConfig,
    executor:  executorConfig,
    reason:    analysis.reason,
  };
}
