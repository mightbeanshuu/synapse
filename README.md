# synapse

> Two AI CLIs. One project. Roles assigned by analysis. Built in parallel.

**synapse** is a terminal orchestrator that connects Claude Code and Gemini CLI, makes one of them analyse both CLIs' strengths, assigns roles from that analysis, then fires both at your project brief — simultaneously, with a second exchange round to fill gaps.

```
███████╗██╗   ██╗███╗   ██╗ █████╗ ██████╗ ███████╗███████╗
██╔════╝╚██╗ ██╔╝████╗  ██║██╔══██╗██╔══██╗██╔════╝██╔════╝
███████╗ ╚████╔╝ ██╔██╗ ██║███████║██████╔╝███████╗█████╗
╚════██║  ╚██╔╝  ██║╚██╗██║██╔══██║██╔═══╝ ╚════██║██╔══╝
███████║   ██║   ██║ ╚████║██║  ██║██║     ███████║███████╗
╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝     ╚══════╝╚══════╝
  Two AI CLIs. One project. Roles assigned. Built in parallel.
  v2.0.0 · Claude Code + Gemini CLI + Codex CLI
```

---

## What's new in 2.0

Synapse 2.0 turns the orchestrator from "two CLIs in parallel" into a coordinated team.

- **Real-time MCP collaboration** — every CLI shares a message bus and a key/value
  context store over MCP, with atomic cross-process writes (no more clobbered state),
  an unread-message cursor, `wait_for_context` to block on a partner's API contract,
  and `list_agents` presence. Agents publish interfaces early and wire against them
  instead of guessing.
- **Bash-permission delegation** — when one CLI is blocked from a shell command
  (sandbox, safe mode, permission denied), it calls `request_bash` and a partner runs
  it and hands back the output. No CLI gets stuck because it lacks a permission another has.
- **Skills system** (`src/skills/*.md`) — composable skill files injected into preambles
  by project type. User-extensible via `<project>/.synapse/skills/*.md`.
- **Domain-aware roles** — the brief is classified (web-app, api, data, ml, …) and roles
  are specialized (e.g. *API Designer · Implementation Lead · Security Reviewer*) with the
  matching skills auto-loaded.
- **Pre-build idea validator** — a reality check against GitHub + npm before building,
  with a `reality_signal` score and the closest existing projects.
- **TDD mode** and an optional **Phase 3 auto-review** that audits the whole codebase
  into a graded `REVIEW.md`.
- **Rate-limiter** — quota/429 errors trigger exponential backoff + retry (30s/90s/270s)
  instead of dropping the agent.
- **Session memory** — each run writes `.synapse/CONTEXT.md`; the next run in the same
  directory starts already knowing what was built.
- **Post-build security scan** — flags hardcoded secrets, SQL-injection patterns, open
  CORS, and dangerous eval/exec before the session closes.

```bash
npm start "Build a REST API for tasks" --tdd --review   # flags also set interactively
```

---

## How it works

```
[You] → project brief
         │
    [synapse opens]
    • SYNAPSE banner
    • pick connection method
         │
    [Analysis phase]
    Claude analyses both CLIs →
    generates capability table →
    roles auto-assigned
         │
         ├──────────────────────┐
    Architect              Executor
    (logic, design,        (files, code,
     edge cases)            tests, setup)
         │                    │
    Phase 1: both run simultaneously (parallel)
         │                    │
    Phase 2: each reviews the other's output
         │                    │
         └──────┬─────────────┘
           session.md  +  _bridge.md
```

### Connection Methods

synapse supports 7 connection strategies between the CLI processes. Pick one at startup:

| # | Method | Status | Description |
|---|--------|--------|-------------|
| 1 | ⚡ **Parallel Streams** | ✅ Ready | Both CLIs run simultaneously, stdout streamed live. Fastest wall-clock time. |
| 2 | 📄 **File Bridge** | ✅ Ready | Shared markdown file with md5 polling. Turn-based, zero dependencies. |
| 3 | 🔗 **Pipeline** | ✅ Ready | CLI1 output pipes directly into CLI2 stdin. Single-pass chained execution. |
| 4 | 🔀 **Named Pipe (FIFO)** | 🔜 Soon | `mkfifo` OS-level pipes. Lower latency than file I/O, bidirectional. |
| 5 | 🌐 **TCP Socket Hub** | 🔜 Soon | Orchestrator routes via localhost TCP. Works across machines via SSH tunnel. |
| 6 | 🗄️ **SQLite Queue** | 🔜 Soon | Persistent async message queue. Retry logic, survives crashes. |
| 7 | 🔌 **WebSocket Hub** | 🔜 Soon | Local WS server, real-time bidirectional routing. Supports N CLIs. |

### Dynamic Role Assignment

At startup, Claude analyses both CLIs across **10 dimensions**:

| Dimension | Drives Role |
|-----------|------------|
| Code Architecture & Design | Architect |
| Core Logic & Algorithms | Architect |
| Edge Case Identification | Architect |
| Debugging & Root Cause | Architect |
| Creative Problem Solving | Architect |
| Code Generation Speed | Executor |
| Boilerplate & File Setup | Executor |
| Test Writing | Executor |
| Tool & Command Execution | Executor |
| Documentation | Either |

Whichever CLI scores higher in the Architect dimensions gets the Architect role (system design, logic, edge cases, review). The other gets Executor (file structure, implementation, tests, setup). The assignment is printed with a one-line rationale before the build starts.

### Build Phases

**Phase 1 — Parallel Build**  
Both CLIs receive the brief + their role preamble simultaneously via `Promise.all`. No waiting.

**Phase 2 — Exchange**  
Each CLI reads the other's Phase 1 output and fills the gaps from its role's perspective. Also parallel.

---

## Prerequisites

- **Node.js 18+**
- **Claude Code CLI** — [install](https://claude.ai/code), authenticated
- **Gemini CLI** — `brew install node && npm i -g @google/gemini-cli`, authenticated

Verify both work:
```bash
claude --print "hello" && gemini -p "hello"
```

---

## Setup

```bash
git clone https://github.com/mightbeanshuu/synapse.git
cd synapse
npm install
```

---

## Usage

```bash
# Interactive mode — shows banner + prompts
npm start

# Pass brief directly (skips brief prompt, still shows method selector)
npm start "Build a JWT auth system in Node.js"

# Specify project directory for both CLIs to work in
npm start "Add Stripe payment integration" -- --dir /path/to/your/project

# Or with npx/tsx directly
npx tsx src/index.ts "Build a REST API for task management"
```

### What you'll see

```
SYNAPSE banner

? Project brief: Build a JWT auth system in Node.js

? Select connection method:
❯ ⚡  Parallel Streams          Both CLIs run simultaneously · fastest
  📄  File Bridge               Shared markdown file · turn-based · zero deps
  🔗  Pipeline                  CLI1 output → CLI2 stdin · single-pass chain
  🔀  Named Pipe (FIFO)         OS-level mkfifo · low latency   [coming soon]
  🌐  TCP Socket Hub            localhost TCP routing            [coming soon]
  🗄️   SQLite Message Queue      Persistent async queue          [coming soon]
  🔌  WebSocket Hub             Local WS server · N CLIs        [coming soon]

✓ Both CLIs connected

✓ Capability analysis complete

  Capability Comparison
  ┌──────────────────────────────────┬────────┬────────┬───────────┐
  │ Dimension                        │ Claude │ Gemini │ Advantage │
  ├──────────────────────────────────┼────────┼────────┼───────────┤
  │ Code Architecture & Design       │  9/10  │  7/10  │  Claude   │
  │ Core Logic & Algorithms          │  9/10  │  7/10  │  Claude   │
  │ Edge Case Identification         │  9/10  │  6/10  │  Claude   │
  │ Code Generation Speed            │  7/10  │  9/10  │  Gemini   │
  │ Boilerplate & File Setup         │  7/10  │  9/10  │  Gemini   │
  │ Test Writing                     │  7/10  │  8/10  │  Gemini   │
  │ Debugging & Root Cause           │  9/10  │  7/10  │  Claude   │
  │ Documentation                    │  8/10  │  8/10  │   Tie     │
  │ Tool & Command Execution         │  7/10  │  9/10  │  Gemini   │
  │ Creative Problem Solving         │  9/10  │  7/10  │  Claude   │
  └──────────────────────────────────┴────────┴────────┴───────────┘

✓ Claude (Architect)  → Architecture · Logic · Edge Cases · Review
✓ Gemini (Executor)   → Implementation · Boilerplate · Tests · Setup

  Rationale: Claude excels at deep reasoning (36/40 in architecture dims);
  Gemini executes faster with superior tool use (26/30 in build dims).

? Ready to build? (Y/n) Y

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
║          Session Complete                ║
╚══════════════════════════════════════════╝

Wall-clock time : 20.6s
Session file    : output/session-2026-05-24T.../session.md
Bridge file     : output/session-2026-05-24T.../_bridge.md
```

---

## Project structure

```
synapse/
├── src/
│   ├── index.ts              # entry point — banner, menus, analysis, orchestration
│   ├── orchestrator.ts       # core phase 1 + phase 2 runner
│   ├── analyzer.ts           # asks Claude to generate the comparison table, parses it
│   ├── assigner.ts           # maps scores → architect/executor CLIConfig objects
│   ├── runner.ts             # child_process.spawn wrapper for each CLI
│   ├── bridge.ts             # bridge file append/read
│   ├── prompts.ts            # phase1 and phase2 prompt builders
│   ├── types.ts              # shared TypeScript interfaces
│   ├── ui/
│   │   └── banner.ts         # figlet SYNAPSE banner
│   └── connect/
│       └── methods.ts        # connection method definitions
├── roles.json                # fallback static role config
├── output/                   # auto-created — one folder per session
├── package.json
└── tsconfig.json
```

---

## Customizing roles

The role preambles live in `src/assigner.ts`. Edit them to change what each CLI focuses on.

The analysis prompt lives in `src/analyzer.ts`. Edit `ANALYSIS_PROMPT` to change the dimensions or scoring criteria.

---

## Output

Each session creates `output/session-<timestamp>/`:

```
session-2026-05-24T10-30-00/
├── session.md     ← all 4 outputs in one clean file
└── _bridge.md     ← raw inter-CLI communication log
```

---

## Inspiration

Built on the `_agent_bridge.md` pattern — a shared-file IPC mechanism where two AI CLIs communicate through a watched markdown file, each taking turns like a half-duplex radio. synapse automates the whole loop: role analysis, prompt injection, parallel execution, exchange, and output collection.

---

MIT License · [github.com/mightbeanshuu/synapse](https://github.com/mightbeanshuu/synapse)
