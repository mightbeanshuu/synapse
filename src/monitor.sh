#!/bin/bash
# Synapse Activity Monitor — runs in the bottom tmux pane
# Usage: monitor.sh <bridge_file> <project_dir> <cli_name...>
BRIDGE="$1"; PROJECT="$2"; shift 2; CLI_NAMES=("$@")

R=$'\033[0m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; BOLD=$'\033[1m'
BLUE=$'\033[34m'; MAGENTA=$'\033[35m'

ts() { date +%H:%M:%S; }

divider() { printf "${CYAN}%0.s─${R}" $(seq 1 $(tput cols 2>/dev/null || echo 80)); echo; }

# Header
clear
divider
echo -e "${CYAN}${BOLD}  ⬡  SYNAPSE  Activity Feed${R}${DIM}  —  ${PROJECT}${R}"
divider

# Track state
last_bridge=0; last_files=0; stall_rounds=0; shown_markers=""
touch /tmp/.syn_ref_$$

event() {
  local color="$1"; local icon="$2"; local who="$3"; local msg="$4"
  printf "  ${DIM}$(ts)${R}  ${color}${icon}${R}  ${BOLD}${who}${R}  ${msg}\n"
}

while true; do
  # ── Bridge: new done markers ───────────────────────────────────────────────
  if [[ -f "$BRIDGE" ]]; then
    cur=$(wc -l < "$BRIDGE" | tr -d ' ')
    if (( cur > last_bridge )); then
      mapfile -t new_lines < <(tail -n "+$((last_bridge + 1))" "$BRIDGE")
      for line in "${new_lines[@]}"; do
        if [[ "$line" =~ ^([A-Z]+)_P([0-9]+)_DONE$ ]]; then
          cli_raw="${BASH_REMATCH[1],,}"
          ph="${BASH_REMATCH[2]}"
          [[ "$cli_raw" == "claude" ]] && col="$CYAN" || { [[ "$cli_raw" == "gemini" ]] && col="$BLUE" || col="$GREEN"; }
          event "$col" "✓" "${cli_raw^}" "Phase ${ph} complete"
        fi
      done
      last_bridge=$cur
      stall_rounds=0
    fi
  fi

  # ── Filesystem: new / changed files ───────────────────────────────────────
  cur_files=$(find "$PROJECT" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')
  if (( cur_files > last_files )); then
    mapfile -t new_files < <(find "$PROJECT" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' -newer /tmp/.syn_ref_$$ 2>/dev/null | head -8)
    for f in "${new_files[@]}"; do
      [[ -n "$f" ]] && event "$YELLOW" "+" "file" "${f#$PROJECT/}"
    done
    last_files=$cur_files
    stall_rounds=0
    touch /tmp/.syn_ref_$$
  else
    (( stall_rounds++ ))
    if (( stall_rounds == 3 )); then
      event "$RED" "⚠" "health" "No file changes in ~90s — CLIs may be stalled or done"
    fi
    if (( stall_rounds == 6 )); then
      event "$RED" "⚠" "health" "Still no activity — check the CLI panes above"
      stall_rounds=0
    fi
  fi

  sleep 30
done
