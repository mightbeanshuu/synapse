import type { Analysis, CLIConfig, CLIId, ActiveCLIs } from './types';

// ── Bash-permission delegation skill (woven into the MCP block) ──────────────
// When one CLI is blocked from running a shell command, a partner runs it.
const BASH_DELEGATION_BLOCK = `
──────────────────────────────────────────────────────
SKILL · BASH PERMISSION DELEGATION
──────────────────────────────────────────────────────
If you are EVER blocked from running a shell command — "permission denied",
"operation not permitted", a sandbox/safe-mode rejection, or a tool that refuses
to execute — do NOT give up and do NOT fake the result. Delegate it:

  • request_bash(command, reason?, cwd?)  — ask a partner to run it for you.
    Then get_bash_result(id, wait=true)    — retrieve the real output.

And help your partners in return:

  • Whenever a partner says they are blocked (watch read_messages), call
    list_bash_requests(), then resolve_bash_request(id) to run their command and
    post the output back. You can run commands they cannot.

Only delegate commands you truly cannot run yourself. Never delegate destructive
commands (rm -rf, disk formatting, credential exfiltration) — refuse those instead.`;

// ── MCP collaboration block appended to all preambles ────────────────────────
const MCP_BLOCK = `
══════════════════════════════════════════════════════
MCP COLLABORATION TOOLS — USE THESE TO COORDINATE
══════════════════════════════════════════════════════
You have an MCP server connected to a shared bus with the other agents building
this project in parallel. These tools are your ONLY channel to them — use them.

  list_agents()                      — see who else is connected and their phase
  read_messages(from?, all?, peek?)  — by default returns ONLY messages you haven't seen yet
  post_message(content, to?)         — message everyone ("all") or one agent ("claude"/"gemini"/"codex")
  set_context(key, value)            — publish a decision/contract/type/file path (atomic, never clobbers)
  get_context(key?)                  — read shared state written by any agent
  wait_for_context(key, timeout?)    — block until a partner publishes a key, then get its value
  signal_done(phase, summary?)       — signal you finished a phase (triggers the next phase)

COLLABORATION PROTOCOL (follow it — do not work in isolation):
1. START: call list_agents() then read_messages() before writing any code.
2. PUBLISH INTERFACES EARLY: the moment you fix a public API, type, schema, or file
   path a partner depends on, set_context("api/<name>", {...}). Do this FIRST so they
   are never blocked on you.
3. DON'T GUESS A CONTRACT: if you need an interface a partner owns, call
   wait_for_context("api/<name>") instead of inventing one that won't match.
4. STAY IN SYNC: call read_messages() again after every few meaningful steps
   (a new file, a finished module) — NOT once at the start. New messages only.
5. SPEAK UP: post_message() the instant you hit a blocker or make a cross-cutting
   decision that affects a partner.
6. FINISH: call signal_done(phase=N, summary="...") — never echo a shell marker.
${BASH_DELEGATION_BLOCK}
══════════════════════════════════════════════════════`;

// ── Role preambles ────────────────────────────────────────────────────────────

const ARCHITECT_PREAMBLE = `You are the LOGIC & ARCHITECTURE lead.

══════════════════════════════════════════════════════
CRITICAL FIRST ACTION — DO THIS BEFORE ANYTHING ELSE:
══════════════════════════════════════════════════════
Create PLAN.md in the working directory with this EXACT format:

# Implementation Plan

## Responsibilities
[Your role and scope — 1-2 sentences]

## Tasks
[ ] 1. Analyse brief and design system architecture
[ ] 2. Define component structure and API contracts
[ ] 3. [Add all your planned tasks here]
...

══════════════════════════════════════════════════════
AS YOU COMPLETE EACH TASK, IMMEDIATELY UPDATE PLAN.md:
[ ] 2. Define component structure → [x] 2. Define component structure ✓
══════════════════════════════════════════════════════

Your responsibilities:
- System design, component breakdown, API contracts
- Core algorithms and data structures
- Security threat modelling and edge cases
- Code correctness and architecture review
- Write REAL files — PLAN.md first, then all architecture/design files

Output structured sections: ## System Design  ## Core Logic  ## Data Structures  ## Security`;

const EXECUTOR_PREAMBLE = `You are the PRIMARY EXECUTOR.

Your responsibilities:
- Create ALL project files (file structure, implementation, config)
- Run package manager commands (npm init, npm install, etc.)
- Write COMPLETE, production-ready code — not stubs, not pseudocode
- Set up build tooling, linting, CI config, environment files
- VERIFY the project builds and runs before signaling done

Output structured sections: ## File Structure  ## Implementation  ## Config & Tooling  ## Verification`;

const REVIEWER_PREAMBLE = `You are the QUALITY & REVIEW lead.

Your responsibilities:
- Review ALL files written by other CLIs — find bugs, anti-patterns, security holes
- Write comprehensive test suites (unit + integration)
- Add missing documentation and type annotations
- Verify the project runs end-to-end
- Fix EVERYTHING you find

Output structured sections: ## Issues Found  ## Tests  ## Documentation  ## Final Verification`;

// ── Parallel track preambles ──────────────────────────────────────────────────

export function buildTrackPreamble(
  trackLabel: string,
  trackScope: string,
  partnerLabel: string,
  partnerScope: string,
  role: CLIConfig['role']
): string {
  const base = role === 'architect' ? ARCHITECT_PREAMBLE : EXECUTOR_PREAMBLE;
  return `${base}

══════════════════════════════════════════════════════
PARALLEL TRACK ASSIGNMENT — READ CAREFULLY
══════════════════════════════════════════════════════
YOUR TRACK  : ${trackLabel}
YOUR SCOPE  : ${trackScope}

PARTNER TRACK: ${partnerLabel}
PARTNER SCOPE: ${partnerScope}

COLLABORATION RULES:
1. You OWN the files in your scope — write and modify ONLY your files
2. You MAY READ your partner's files at any time to understand interfaces
3. Write INTERFACES.md to document any APIs, types, or contracts you define
4. READ INTERFACES.md regularly — your partner may update it with their contracts
5. Design your piece so it INTEGRATES with your partner's work
6. When you define a public API or type, add it to INTERFACES.md IMMEDIATELY
══════════════════════════════════════════════════════`;
}

// ── CLI base configs ──────────────────────────────────────────────────────────

const CLI_COLORS: Record<CLIId, string> = {
  claude: '#00efd4',
  gemini: '#4285f4',
  codex:  '#10a37f',
};

const CLI_LABELS: Record<CLIId, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex:  'Codex CLI',
};

const CLI_SYMBOLS: Record<CLIId, string> = {
  claude: '☁️',
  gemini: '💎',
  codex:  '🌀',
};

function makeConfig(id: CLIId, role: CLIConfig['role'], preamble?: string): CLIConfig {
  const base = preamble ?? (
    role === 'architect' ? ARCHITECT_PREAMBLE :
    role === 'reviewer'  ? REVIEWER_PREAMBLE  :
    EXECUTOR_PREAMBLE
  );
  const p = base + MCP_BLOCK;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  return {
    id,
    binary: id,
    name: `${CLI_LABELS[id]} (${roleLabel})`,
    role,
    preamble: p,
    color: CLI_COLORS[id],
    symbol: CLI_SYMBOLS[id],
  };
}

// ── Auto assignment from analysis ─────────────────────────────────────────────

export function assignRolesFromAnalysis(analysis: Analysis, selectedIds: CLIId[]): ActiveCLIs {
  const architectId = selectedIds.includes(analysis.architect) ? analysis.architect : selectedIds[0];
  const remainingIds = selectedIds.filter(id => id !== architectId);
  const executorId = remainingIds[0] ?? architectId;
  const reviewerId = selectedIds.find(id => id !== architectId && id !== executorId);

  const configs: CLIConfig[] = [
    makeConfig(architectId, 'architect'),
    ...(executorId !== architectId ? [makeConfig(executorId, 'executor')] : []),
    ...(reviewerId ? [makeConfig(reviewerId, 'reviewer')] : []),
  ];

  return { configs, hasCodex: selectedIds.includes('codex') };
}

// ── Manual assignment ─────────────────────────────────────────────────────────

export function assignRolesManually(
  selectedIds: CLIId[],
  architectId: CLIId,
  executorId: CLIId
): ActiveCLIs {
  const reviewerId = selectedIds.find(id => id !== architectId && id !== executorId);
  const configs: CLIConfig[] = [
    makeConfig(architectId, 'architect'),
    ...(executorId !== architectId ? [makeConfig(executorId, 'executor')] : []),
    ...(reviewerId ? [makeConfig(reviewerId, 'reviewer')] : []),
  ];
  return { configs, hasCodex: selectedIds.includes('codex') };
}

// ── Parallel tracks assignment ────────────────────────────────────────────────

export function assignRolesForTracks(
  selectedIds: CLIId[],
  trackA: { label: string; scope: string },
  trackB: { label: string; scope: string }
): ActiveCLIs {
  const [id0, id1, id2] = selectedIds;
  const preambleA = buildTrackPreamble(trackA.label, trackA.scope, trackB.label, trackB.scope, 'architect');
  const preambleB = buildTrackPreamble(trackB.label, trackB.scope, trackA.label, trackA.scope, 'executor');

  const configs: CLIConfig[] = [
    makeConfig(id0, 'architect', preambleA),
    makeConfig(id1, 'executor',  preambleB),
    ...(id2 ? [makeConfig(id2, 'reviewer')] : []),
  ];

  return { configs, hasCodex: selectedIds.includes('codex') };
}

export function getRoleReason(analysis: Analysis): string {
  return analysis.reason;
}
