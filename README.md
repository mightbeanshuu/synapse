# synapse

> Two AI CLIs. One project. Roles assigned. Built in parallel.

**synapse** is a TypeScript orchestrator that connects two AI CLIs (Claude Code + Gemini CLI), assigns each a distinct role based on their strengths, fires them simultaneously at your project brief, then makes them review each other's output — all automated, zero manual switching.

```
[You] → "Build a REST API for task management"
           │
      [synapse]
      assigns roles
           │
    ┌──────┴──────┐
 Claude         Gemini
(Architect)   (Executor)
 - design     - file structure
 - core logic - full implementation
 - edge cases - test cases
    └──────┬──────┘
     [bridge file]
    Phase 2: exchange
    each reviews the other
           │
    [session.md]  ← final merged output
```

## How it works

**Phase 1 — Parallel Build**
Both CLIs get the brief + their role preamble. They run simultaneously via `Promise.all`. No waiting.

**Phase 2 — Exchange**
Each CLI receives the other's Phase 1 output and fills the gaps from their role's perspective. Also parallel.

**Output**
Every session writes to `output/session-<timestamp>/`:
- `session.md` — all four outputs in one clean file
- `_bridge.md` — the raw inter-CLI communication log

## Roles

Defined in `roles.json`. Fully customizable.

| CLI | Default Role | Focus |
|-----|-------------|-------|
| Claude | Architect | System design, core logic, edge cases, security |
| Gemini | Executor | File structure, full implementation, tests, setup |

## Setup

```bash
git clone https://github.com/mightbeanshuu/synapse.git
cd synapse
npm install
```

**Prerequisites:**
- [Claude Code CLI](https://claude.ai/code) — installed and authenticated
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) — installed (`brew install gemini-cli` or via npm)
- Node.js 18+

## Usage

```bash
# Basic
npx tsx src/orchestrator.ts "Build a JWT auth system in Node.js"

# Specify a project directory for both CLIs to work in
npx tsx src/orchestrator.ts "Add Stripe payment integration" --dir /path/to/your/project

# As npm script
npm start "Build a REST API for task management"
```

## Customizing roles

Edit `roles.json` to change which CLI does what:

```json
{
  "cli1": {
    "binary": "claude",
    "name": "Claude (Architect)",
    "preamble": "You are the LOGIC & ARCHITECTURE lead..."
  },
  "cli2": {
    "binary": "gemini",
    "name": "Gemini (Executor)",
    "preamble": "You are the EXECUTION & BUILD lead..."
  }
}
```

You can flip the roles, add more specific instructions, or swap in a different CLI binary entirely.

## Project structure

```
synapse/
├── src/
│   ├── orchestrator.ts   # entry point — arg parsing, phase orchestration
│   ├── runner.ts         # child_process.spawn wrapper for each CLI
│   ├── bridge.ts         # bridge file I/O (append, read)
│   ├── prompts.ts        # phase1 and phase2 prompt builders
│   └── types.ts          # shared TypeScript interfaces
├── roles.json            # static role config (edit this)
├── output/               # auto-created — one folder per session
├── package.json
└── tsconfig.json
```

## Example output

```
╔══════════════════════════════════════════╗
║          CLI Duo Orchestrator             ║
╚══════════════════════════════════════════╝

Brief    : Build a JWT auth system in Node.js
CLI 1    : Claude (Architect) (claude)
CLI 2    : Gemini (Executor) (gemini)
Mode     : Parallel → Exchange

┌─────────────────────────────────────────┐
│  PHASE 1 — Parallel Build               │
└─────────────────────────────────────────┘

[Claude (Architect)] ## System Design ...
[Gemini (Executor)]  ## File Structure ...

✓ Claude (Architect) — 12.4s
✓ Gemini (Executor) — 9.1s

┌─────────────────────────────────────────┐
│  PHASE 2 — Exchange & Fill Gaps         │
└─────────────────────────────────────────┘

✓ Claude (Architect) exchange — 8.2s
✓ Gemini (Executor) exchange — 7.6s

╔══════════════════════════════════════════╗
║              Session Complete             ║
╚══════════════════════════════════════════╝

Session file : output/session-2026-05-24T.../session.md
Bridge file  : output/session-2026-05-24T.../_bridge.md
```

## Motivation

Built on the `_agent_bridge.md` pattern — a shared-file IPC mechanism where two AI CLIs communicate through a watched markdown file. synapse automates the whole loop: prompt injection, parallel execution, turn detection, and output collection.

---

MIT License
