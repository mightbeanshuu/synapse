#!/bin/bash
# Synapse Activity Monitor — bash 3.2 compatible (no mapfile)
# Usage: monitor.sh <bridge_file> <project_dir> <cli_name...>
BRIDGE="$1"; PROJECT="$2"; shift 2

R=$'\033[0m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; BOLD=$'\033[1m'
BLUE=$'\033[34m'

ts() { date +%H:%M:%S; }

divider() {
  local cols; cols=$(tput cols 2>/dev/null || echo 80)
  printf "${CYAN}"; printf '%0.s─' $(seq 1 "$cols"); printf "${R}\n"
}

event() {
  local color="$1" icon="$2" who="$3" msg="$4"
  printf "  ${DIM}$(ts)${R}  ${color}${icon}${R}  ${BOLD}${who}${R}  ${msg}\n"
}

clear
divider
printf "${CYAN}${BOLD}  ⬡  SYNAPSE  Activity Feed${R}${DIM}  —  ${PROJECT}${R}\n"
divider

last_bridge=0; last_files=0; stall_rounds=0; shown_markers=""
touch /tmp/.syn_ref_$$
trap 'rm -f /tmp/.syn_ref_$$' EXIT

while true; do
  # ── Bridge: new done markers ───────────────────────────────────────────────
  if [ -f "$BRIDGE" ]; then
    cur=$(wc -l < "$BRIDGE" | tr -d ' ')
    if [ "$cur" -gt "$last_bridge" ]; then
      start_line=$((last_bridge + 1))
      while IFS= read -r line; do
        case "$line" in
          *_P1_DONE|*_P2_DONE)
            cli_raw=$(echo "$line" | sed 's/_P[0-9]*_DONE//' | tr '[:upper:]' '[:lower:]')
            ph=$(echo "$line" | grep -oE 'P[0-9]')
            case "$cli_raw" in
              claude) col="$CYAN" ;;
              gemini) col="$BLUE" ;;
              *)      col="$GREEN" ;;
            esac
            event "$col" "✓" "${cli_raw^}" "Phase ${ph} complete"
            ;;
        esac
      done < <(tail -n "+${start_line}" "$BRIDGE" 2>/dev/null)
      last_bridge=$cur
      stall_rounds=0
    fi
  fi

  # ── Filesystem: new files ──────────────────────────────────────────────────
  cur_files=$(find "$PROJECT" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$cur_files" -gt "$last_files" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && event "$YELLOW" "+" "file" "${f#$PROJECT/}"
    done < <(find "$PROJECT" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' -newer /tmp/.syn_ref_$$ 2>/dev/null | head -8)
    last_files=$cur_files
    stall_rounds=0
    touch /tmp/.syn_ref_$$
  else
    stall_rounds=$((stall_rounds + 1))
    if [ "$stall_rounds" -eq 3 ]; then
      event "$RED" "⚠" "health" "No file changes in ~90s — CLIs may be stalled or thinking"
    fi
    if [ "$stall_rounds" -eq 7 ]; then
      event "$RED" "⚠" "health" "Still no activity — check the CLI panes above for errors"
      stall_rounds=0
    fi
  fi

  sleep 30
done
