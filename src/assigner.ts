import type { Analysis, CLIConfig, CLIId, ActiveCLIs } from './types';

// ── Role preambles ───────────────────────────────────────────────────────────

const ARCHITECT_PREAMBLE = `You are the LOGIC & ARCHITECTURE lead. Your responsibilities:
- System design, component breakdown, API contracts
- Core algorithms and data structures
- Security threat modelling and edge cases
- Code correctness review

Output structured sections: ## System Design  ## Core Logic  ## Data Structures  ## Security & Edge Cases
Be terse. No boilerplate. Focus on what ONLY an architect would catch.`;

const EXECUTOR_PREAMBLE = `You are the PRIMARY EXECUTOR. Your responsibilities:
- Create ALL project files (file structure, implementation, config)
- Run package manager commands (npm init, npm install, etc.)
- Write complete, production-ready code — not stubs
- Set up build tooling, linting, environment files

Output structured sections: ## File Structure  ## Implementation  ## Config & Tooling  ## Setup Commands
Write complete code. Run commands. Make the project actually work.`;

const REVIEWER_PREAMBLE = `You are the QUALITY & REVIEW lead. Your responsibilities:
- Review all files written by other CLIs for bugs, anti-patterns, security holes
- Write comprehensive test suites (unit + integration)
- Add missing documentation and type annotations
- Verify the project actually runs end-to-end

Output structured sections: ## Issues Found  ## Tests  ## Documentation  ## Final Verification
Be ruthless. Find every gap. Verify with actual runs.`;

// ── CLI base configs ─────────────────────────────────────────────────────────

function makeConfig(
  id: CLIId,
  binary: string,
  role: CLIConfig['role'],
  color: string
): CLIConfig {
  const preamble =
    role === 'architect' ? ARCHITECT_PREAMBLE :
    role === 'reviewer'  ? REVIEWER_PREAMBLE  :
    EXECUTOR_PREAMBLE;

  const label = id === 'claude' ? 'Claude Code' : id === 'gemini' ? 'Gemini CLI' : 'Codex CLI';
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  return {
    id,
    binary,
    name: `${label} (${roleLabel})`,
    role,
    preamble,
    color,
  };
}

// ── Public helpers ────────────────────────────────────────────────────────────

export function assignRolesFromAnalysis(
  analysis: Analysis,
  selectedIds: CLIId[]
): ActiveCLIs {
  const configs: CLIConfig[] = [];

  // Assign architect + executor from analysis
  const architectId = selectedIds.includes(analysis.architect) ? analysis.architect : selectedIds[0];
  const remainingIds = selectedIds.filter(id => id !== architectId);
  const executorId = remainingIds[0] ?? architectId;

  configs.push(makeConfig(architectId, architectId, 'architect', architectId === 'claude' ? '#00efd4' : architectId === 'gemini' ? '#4285f4' : '#10a37f'));
  if (executorId !== architectId) {
    configs.push(makeConfig(executorId, executorId, 'executor', executorId === 'claude' ? '#00efd4' : executorId === 'gemini' ? '#4285f4' : '#10a37f'));
  }

  // Codex is always reviewer when it's the 3rd CLI
  const reviewerId = selectedIds.find(id => id !== architectId && id !== executorId);
  if (reviewerId) {
    configs.push(makeConfig(reviewerId, reviewerId, 'reviewer', '#10a37f'));
  }

  return { configs, hasCodex: selectedIds.includes('codex') };
}

export function getRoleReason(analysis: Analysis): string {
  return analysis.reason;
}
