#!/bin/bash
# SYNAPSE  ·  Agent Stream  v2.0
# Args: <cli_id> <symbol> <log_p1> <log_p2> <pipe_path>
CLI_ID="$1"; SYMBOL="$2"; LOG_P1="$3"; LOG_P2="$4"; PIPE="$5"

# ── ANSI ─────────────────────────────────────────────────────────────────────
R=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
BLUE=$'\033[34m'; MAGENTA=$'\033[35m'; CYAN=$'\033[36m'
TEAL=$'\033[38;5;51m'; ORANGE=$'\033[38;5;208m'

case "$CLI_ID" in
  claude) A_CLR="$TEAL";    ROLE="Architect" ;;
  gemini) A_CLR="$BLUE";    ROLE="Executor"  ;;
  codex)  A_CLR="$GREEN";   ROLE="Reviewer"  ;;
  *)      A_CLR="$CYAN";    ROLE="Agent"     ;;
esac

SESSION_DIR=$(dirname "$LOG_P1")
BRIDGE="${SESSION_DIR}/_bridge.md"
T0=$(date +%s)

elapsed() {
  local now d; now=$(date +%s); d=$((now - T0))
  printf '%02d:%02d' $((d/60)) $((d%60))
}

cols() { tput cols 2>/dev/null || echo 80; }

wbar() {
  local c; c=$(cols)
  printf '%s' "$(printf '━%.0s' $(seq 1 "$c"))"
}

hbar() {
  local c; c=$(($(cols) - 4))
  printf "  ${DIM}$(printf '─%.0s' $(seq 1 "$c"))${R}\n"
}

# ── Header ────────────────────────────────────────────────────────────────────
print_header() {
  local b; b=$(wbar)
  clear
  printf "\n${A_CLR}${BOLD}${b}${R}\n\n"
  printf "  ${A_CLR}${BOLD}${SYMBOL}  SYNAPSE  ›  ${CLI_ID^^}${R}   ${DIM}${ROLE}  ·  Phase 1 active  ·  $(date '+%H:%M:%S')${R}\n"
  printf "  ${DIM}session: $(basename "$SESSION_DIR")  ·  log: $(basename "$LOG_P1")${R}\n\n"
  printf "${A_CLR}${BOLD}${b}${R}\n\n"
  printf "  ${DIM}Streaming live output — type below to steer this agent${R}\n\n"
}

# ── Phase transition banner ───────────────────────────────────────────────────
phase2_banner() {
  local b; b=$(wbar)
  printf "\n${A_CLR}${BOLD}${b}${R}\n"
  printf "  ${A_CLR}${BOLD}▶▶  PHASE 2  —  Exchange & Review${R}\n"
  printf "${A_CLR}${BOLD}${b}${R}\n\n"
}

# ── Log line classifier & colorizer ──────────────────────────────────────────
colorize() {
  local raw="$1"
  # Skip blank lines
  [ -z "$(printf '%s' "$raw" | tr -d '[:space:]')" ] && return

  # Phase completion boxes
  case "$raw" in
    *_P1_DONE*)
      printf "\n${GREEN}${BOLD}  ╔════════════════════╗${R}\n"
      printf "${GREEN}${BOLD}  ║  ✓  PHASE 1 DONE  ║${R}\n"
      printf "${GREEN}${BOLD}  ╚════════════════════╝${R}\n\n"; return ;;
    *_P2_DONE*)
      printf "\n${GREEN}${BOLD}  ╔════════════════════╗${R}\n"
      printf "${GREEN}${BOLD}  ║  ✓  PHASE 2 DONE  ║${R}\n"
      printf "${GREEN}${BOLD}  ╚════════════════════╝${R}\n\n"; return ;;
    *_FAILED*)
      printf "\n${RED}${BOLD}  ╔════════════════════╗${R}\n"
      printf "${RED}${BOLD}  ║  ✗  PHASE FAILED  ║${R}\n"
      printf "${RED}${BOLD}  ╚════════════════════╝${R}\n\n"; return ;;
  esac

  # Strip CLI symbol prefix (emoji + space)
  local txt; txt=$(printf '%s' "$raw" | LC_ALL=C sed 's/^[^ ][^ ]*[[:space:]]*//')
  [ -z "$txt" ] && txt="$raw"

  local ts; ts=$(date +%H:%M:%S)
  local t="${DIM}${ts}${R}"

  case "$txt" in
    # Errors — red, prominent
    *[Ee]rror*|*ERROR*|*FAIL*|*[Ff]ailed*|*[Cc]annot*|*[Ee]xception*|*[Tt]raceback*|*"SyntaxError"*|*"TypeError"*)
      printf "  %s  ${RED}${BOLD}✗ error   ${R}%s\n" "$t" "$txt" ;;
    # Warnings — yellow
    *[Ww]arning*|*WARN*|*[Dd]eprecate*)
      printf "  %s  ${YELLOW}⚠ warn    ${R}${DIM}%s${R}\n" "$t" "$txt" ;;
    # File creation — bright green
    *"Writing file"*|*"Created file"*|*"write_file"*|*"create_file"*|*"Saving"*)
      printf "  %s  ${GREEN}${BOLD}✦ create  ${R}%s\n" "$t" "$txt" ;;
    # File writing — green
    *"Writing"*|*"Wrote"*|*"Edited"*|*"Updated file"*)
      printf "  %s  ${GREEN}✦ write   ${R}%s\n" "$t" "$txt" ;;
    # File reading — cyan
    *"Reading"*|*"Read("*|*"read_file"*|*"View("*)
      printf "  %s  ${CYAN}◎ read    ${R}${DIM}%s${R}\n" "$t" "$txt" ;;
    # Analysis/inspection — cyan dim
    *[Aa]nalyz*|*[Ii]nspect*|*[Cc]hecking*|*[Aa]udit*|*[Ss]canning*)
      printf "  %s  ${CYAN}◎ check   ${R}${DIM}%s${R}\n" "$t" "$txt" ;;
    # Package/build execution — orange
    *"npm install"*|*"npm run"*|*"yarn"*|*"pip install"*|*"cargo build"*|*"go build"*|*"make"*|*"Bash("*)
      printf "  %s  ${ORANGE}⊞ exec    ${R}%s\n" "$t" "$txt" ;;
    # Tests — magenta
    *" test"*|*"[Tt]est("*|*"jest"*|*"pytest"*|*"vitest"*|*"spec"*|*"[Tt]esting"*)
      printf "  %s  ${MAGENTA}⊕ test    ${R}%s\n" "$t" "$txt" ;;
    # Completion — green bold
    *[Cc]omplete*|*[Ss]uccess*|*[Ff]inished*|*"All done"*)
      printf "  %s  ${GREEN}✓ done    ${R}${BOLD}%s${R}\n" "$t" "$txt" ;;
    # Planning/design — blue
    *[Pp]lan*|*[Dd]esign*|*[Aa]rchitect*|*[Ss]tructur*|*[Ii]mplement\ plan*)
      printf "  %s  ${BLUE}◈ plan    ${R}%s\n" "$t" "$txt" ;;
    # Fix/debug — yellow
    *[Ff]ixing*|*[Pp]atching*|*[Rr]efactor*|*[Dd]ebug*|*"Resolving"*)
      printf "  %s  ${YELLOW}⚒ fix     ${R}%s\n" "$t" "$txt" ;;
    # Generic — dim
    *)
      printf "  %s  ${DIM}·         %s${R}\n" "$t" "$txt" ;;
  esac
}

# ── Phase 2 watcher (runs in background, prints banner when P2 starts) ────────
(
  while true; do
    if LC_ALL=C grep -q "${CLI_ID^^}_P1_DONE" "$BRIDGE" 2>/dev/null; then
      sleep 2
      phase2_banner
      break
    fi
    sleep 4
  done
) &
WATCHER_PID=$!

# ── Wait for command pipe to be ready (phase-manager creates it) ──────────────
PIPE_READY=0
for _i in $(seq 1 20); do
  [ -p "$PIPE" ] && { PIPE_READY=1; break; }
  sleep 1
done

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  kill "$WATCHER_PID" "$STREAM_PID" 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

# ── Print header ──────────────────────────────────────────────────────────────
print_header

# ── Stream both phase logs (P2 is empty until phase 2 starts) ─────────────────
# Filter out tail's own "==> file.log <==" headers
touch "$LOG_P1" "$LOG_P2"
tail -n 30 -F "$LOG_P1" "$LOG_P2" 2>/dev/null \
  | LC_ALL=C grep -v '^==>' \
  | while IFS= read -r line; do
      colorize "$line"
    done &
STREAM_PID=$!

# ── Interactive chat loop ─────────────────────────────────────────────────────
while true; do
  printf "\n  ${A_CLR}${BOLD}┌─ ${SYMBOL} ${CLI_ID^^}${R}  ${DIM}$(elapsed) elapsed  ·  ctrl+c exits${R}\n"
  printf "  ${A_CLR}${BOLD}└›${R} "

  if IFS= read -r msg; then
    if [ -n "$msg" ]; then
      if [ "$PIPE_READY" -eq 1 ] && [ -p "$PIPE" ]; then
        printf '/ask %s %s\n' "$CLI_ID" "$msg" >> "$PIPE" 2>/dev/null
        printf "  ${DIM}   ↑ queued for ${CLI_ID} — command center will dispatch${R}\n"
      else
        printf "  ${YELLOW}   ⚠ command center not ready (try again shortly)${R}\n"
      fi
    fi
  fi
done
