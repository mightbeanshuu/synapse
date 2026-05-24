#!/bin/bash
# ───────────────────────────────────────────────────────────────────────────
# SYNAPSE Phase Manager — runs inside tmux, controls full session lifecycle
# Args: bridge session_dir project_dir tmux_session n_clis cli_id...
# ───────────────────────────────────────────────────────────────────────────
BRIDGE="$1"; SESSION_DIR="$2"; PROJECT_DIR="$3"
TMUX_SESSION="$4"; N_CLIS="$5"
shift 5

# ── Collect CLI IDs (bash 3.2 safe) ─────────────────────────────────────────
CLI_ID_0=""; CLI_ID_1=""; CLI_ID_2=""; _i=0
for _arg in "$@"; do
  case "$_i" in 0) CLI_ID_0="$_arg";; 1) CLI_ID_1="$_arg";; 2) CLI_ID_2="$_arg";; esac
  _i=$((_i+1))
done
ALL_IDS="$CLI_ID_0"
[ -n "$CLI_ID_1" ] && ALL_IDS="$ALL_IDS $CLI_ID_1"
[ -n "$CLI_ID_2" ] && ALL_IDS="$ALL_IDS $CLI_ID_2"

# ── Colors ───────────────────────────────────────────────────────────────────
R=$'\033[0m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
RED=$'\033[31m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; BLUE=$'\033[34m'

ts()       { date +%H:%M:%S; }
event()    { printf "  ${DIM}$(ts)${R}  ${1}${2}${R}  ${BOLD}${3}${R}  ${4}\n"; }
divider()  {
  local c; c=$(tput cols 2>/dev/null || echo 80)
  printf "${CYAN}"; printf '%0.s─' $(seq 1 "$c"); printf "${R}\n"
}
cli_col()  {
  case "$1" in claude) echo "$CYAN";; gemini) echo "$BLUE";; codex) echo "$GREEN";; *) echo "$R";; esac
}

# ── Pane mapping ─────────────────────────────────────────────────────────────
pane_for() {
  local i="$1"
  if [ "$N_CLIS" -eq 2 ]; then
    case "$i" in 0) echo "0.0";; 1) echo "0.2";; esac
  else
    case "$i" in 0) echo "0.0";; 1) echo "0.2";; 2) echo "0.3";; esac
  fi
}

# ── Shown plan items (global, bash 3.2 safe via string lookup) ───────────────
SHOWN_PLAN="|"

already_shown_plan() {
  case "$SHOWN_PLAN" in *"|${1}|"*) return 0;; *) return 1;; esac
}

add_shown_plan() { SHOWN_PLAN="${SHOWN_PLAN}${1}|"; }

# ── File-watcher state ───────────────────────────────────────────────────────
touch /tmp/.syn_pm_$$
trap 'rm -f /tmp/.syn_pm_$$' EXIT
LAST_FILES=0

check_new_files() {
  local cur
  cur=$(find "$PROJECT_DIR" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$cur" -gt "$LAST_FILES" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && event "$YELLOW" "+" "file" "${f#$PROJECT_DIR/}"
    done < <(find "$PROJECT_DIR" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' -newer /tmp/.syn_pm_$$ 2>/dev/null | head -10)
    LAST_FILES=$cur
    touch /tmp/.syn_pm_$$
  fi
}

# ── Plan tick watcher ─────────────────────────────────────────────────────────
check_plan_ticks() {
  local PLAN="$PROJECT_DIR/PLAN.md"
  [ ! -f "$PLAN" ] && return
  while IFS= read -r line; do
    case "$line" in
      '[x]'*|'[X]'*)
        task="${line#\[*\] }"
        task="${task% ✓}"; task="${task% (done)}"
        if ! already_shown_plan "$task"; then
          add_shown_plan "$task"
          event "$GREEN" "✓" "plan" "$task"
        fi
        ;;
    esac
  done < "$PLAN"
}

# ── Wait for markers (poll bridge file every 8s) ──────────────────────────────
wait_phase() {
  local phase="$1"; shift
  local ids; ids="$*"
  local stall=0

  while true; do
    # Check done markers
    all_done=1
    for id in $ids; do
      upper=$(echo "$id" | tr '[:lower:]' '[:upper:]')
      marker="${upper}_P${phase}_DONE"
      if ! grep -q "$marker" "$BRIDGE" 2>/dev/null; then
        all_done=0
      else
        key="SEEN_${upper}_P${phase}"
        eval seen=\$"$key"
        if [ -z "$seen" ]; then
          eval "$key=1"
          col=$(cli_col "$id")
          printf "\n"
          event "$col" "✓" "${id^}" "Phase ${phase} complete"
        fi
      fi
    done
    [ "$all_done" -eq 1 ] && break

    check_plan_ticks
    check_new_files

    stall=$((stall+1))
    if [ "$stall" -eq 7 ]; then
      event "$YELLOW" "⟳" "health" "Still building — no new files for ~60s"
      stall=0
    fi

    sleep 8
  done
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
clear
divider
printf "${CYAN}${BOLD}  ⬡  SYNAPSE  Activity Feed${R}  ${DIM}—  ${PROJECT_DIR}${R}\n"
divider
printf "\n"

# ── Phase 1 ──────────────────────────────────────────────────────────────────
event "$CYAN" "⬡" "synapse" "Phase 1 — ${N_CLIS} CLIs building in parallel"
printf "\n"

wait_phase 1 $ALL_IDS

printf "\n"
event "$GREEN" "⬡" "synapse" "Phase 1 complete!"

# ── Show final plan state ─────────────────────────────────────────────────────
PLAN="$PROJECT_DIR/PLAN.md"
if [ -f "$PLAN" ]; then
  printf "\n"
  divider
  printf "${CYAN}${BOLD}  Implementation Plan${R}\n"
  divider
  while IFS= read -r line; do
    case "$line" in
      '[x]'*|'[X]'*)
        task="${line#\[*\] }"; task="${task% ✓}"
        printf "  ${GREEN}✓${R}  ${DIM}${task}${R}\n" ;;
      '[ ]'*|'[-]'*)
        task="${line#\[*\] }"
        printf "  ${YELLOW}○${R}  ${task}\n" ;;
    esac
  done < "$PLAN"
  printf "\n"
fi

# ── Guidance collection ───────────────────────────────────────────────────────
divider
printf "${CYAN}${BOLD}  Phase 2 Guidance${R}  ${DIM}(press Enter to skip each)${R}\n"
divider
printf "\n"

for id in $ALL_IDS; do
  col=$(cli_col "$id")
  printf "  ${col}${BOLD}${id^}${R} guidance: "
  IFS= read -r guidance
  if [ -n "$guidance" ]; then
    printf '%s\n' "$guidance" > "${SESSION_DIR}/guidance_${id}.txt"
  else
    rm -f "${SESSION_DIR}/guidance_${id}.txt"
  fi
done

# ── Phase 2 ──────────────────────────────────────────────────────────────────
printf "\n"
divider
printf "${CYAN}${BOLD}  Phase 2 — Exchange & Review${R}\n"
divider
printf "\n"
event "$CYAN" "⬡" "synapse" "Launching Phase 2..."
printf "\n"

_pi=0
for id in $ALL_IDS; do
  pane=$(pane_for "$_pi")
  script="${SESSION_DIR}/${id}_p2.sh"
  col=$(cli_col "$id")
  if [ -f "$script" ]; then
    tmux select-pane -t "${TMUX_SESSION}:${pane}" -T "${id^}  ·  Phase 2" 2>/dev/null || true
    tmux send-keys -t "${TMUX_SESSION}:${pane}" "" "" 2>/dev/null || true
    tmux send-keys -t "${TMUX_SESSION}:${pane}" "bash '${script}'" Enter 2>/dev/null || true
    event "$col" "▶" "${id^}" "Phase 2 started"
  fi
  _pi=$((_pi+1))
done

printf "\n"
wait_phase 2 $ALL_IDS

# ── Session complete ──────────────────────────────────────────────────────────
printf "\n"
divider
printf "${GREEN}${BOLD}  ✓  SESSION COMPLETE${R}\n"
divider
printf "  ${DIM}Project : ${PROJECT_DIR}${R}\n"
printf "  ${DIM}Session : ${SESSION_DIR}${R}\n"
printf "\n"
printf "${DIM}  Press Enter to detach...${R}"
IFS= read -r _
echo "SESSION_COMPLETE" >> "$BRIDGE"
tmux detach-client 2>/dev/null || true
