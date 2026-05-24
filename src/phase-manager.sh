#!/bin/bash
# ───────────────────────────────────────────────────────────────────────────
# SYNAPSE Activity Feed — runs in its own terminal window
# Args: bridge session_dir project_dir tmux_session n_clis cli_id...
# ───────────────────────────────────────────────────────────────────────────
BRIDGE="$1"; SESSION_DIR="$2"; PROJECT_DIR="$3"
TMUX_SESSION="$4"; N_CLIS="$5"
shift 5

# ── Guardrail timeouts ────────────────────────────────────────────────────────
P1_TIMEOUT=1500     # 25 min hard limit for Phase 1
P2_TIMEOUT=1200     # 20 min hard limit for Phase 2
STALL_WARN=8        # warn after 8 × 8s of no file changes
STALL_KILL=40       # bail after 40 × 8s of zero activity + >2min elapsed

# ── Collect CLI IDs (bash 3.2: no mapfile) ────────────────────────────────────
CLI_ID_0=""; CLI_ID_1=""; CLI_ID_2=""; _ci=0
for _arg in "$@"; do
  case "$_ci" in 0) CLI_ID_0="$_arg";; 1) CLI_ID_1="$_arg";; 2) CLI_ID_2="$_arg";; esac
  _ci=$((_ci+1))
done
ALL_IDS="$CLI_ID_0"
[ -n "$CLI_ID_1" ] && ALL_IDS="$ALL_IDS $CLI_ID_1"
[ -n "$CLI_ID_2" ] && ALL_IDS="$ALL_IDS $CLI_ID_2"

# ── Colors ────────────────────────────────────────────────────────────────────
R=$'\033[0m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
RED=$'\033[31m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; BLUE=$'\033[34m'
TEAL=$'\033[38;5;51m'; MAGENTA=$'\033[35m'

ts()      { date +%H:%M:%S; }
divider() {
  local c; c=$(tput cols 2>/dev/null || echo 80)
  printf "${CYAN}"; printf '%0.s─' $(seq 1 "$c"); printf "${R}\n"
}
cli_col() {
  case "$1" in claude) echo "$CYAN";; gemini) echo "$BLUE";; codex) echo "$GREEN";; *) echo "$R";; esac
}

# ── Pane mapping (new layout: no bottom pane) ─────────────────────────────────
# 2 CLIs: 0.0, 0.1    3 CLIs: 0.0, 0.1, 0.2
pane_for() {
  local i="$1"
  case "$i" in 0) echo "0.0";; 1) echo "0.1";; 2) echo "0.2";; esac
}

# ── Shown plan items (bash 3.2 safe string lookup) ───────────────────────────
SHOWN_PLAN="|"
already_shown() { case "$SHOWN_PLAN" in *"|${1}|"*) return 0;; *) return 1;; esac; }
mark_shown()    { SHOWN_PLAN="${SHOWN_PLAN}${1}|"; }

# ── Spinner / animation ───────────────────────────────────────────────────────
SPINNER_PID=""
SPIN_FRAMES='⣾⣽⣻⢿⡿⣟⣯⣷'

# Working messages — rotate through these while CLIs are active
SPIN_MSG_0="synthesizing the codebase";  SPIN_MSG_1="weaving logic threads"
SPIN_MSG_2="Claude is architecting";     SPIN_MSG_3="Gemini is scaffolding"
SPIN_MSG_4="thinking deeply";            SPIN_MSG_5="crafting the foundation"
SPIN_MSG_6="reading the problem space";  SPIN_MSG_7="designing the solution"
SPIN_MSG_8="building in parallel";       SPIN_MSG_9="neural links active"
SPIN_MSG_10="asking the rubber duck";    SPIN_MSG_11="simulating edge cases"
SPIN_MSG_12="writing the logic";         SPIN_MSG_13="refining the approach"
SPIN_MSG_14="connecting the pieces";     SPIN_MSG_15="doodling the architecture"
SPIN_MSG_16="staring at the problem";    SPIN_MSG_17="channelling Turing"
SPIN_MSG_18="linting the universe";      SPIN_MSG_19="committing to greatness"
SPIN_TOTAL=20

get_spin_msg() {
  local i=$(( ($1) % SPIN_TOTAL ))
  eval echo "\$SPIN_MSG_${i}"
}

start_spinner() {
  local label="${1:-building...}"
  # Runs in a subshell — continuously prints an animated spinner on the current line
  (
    local i=0; local mi=0
    while true; do
      local c="${SPIN_FRAMES:$((i % 8)):1}"
      local msg; msg=$(get_spin_msg "$mi")
      printf "\r  ${TEAL}${c}${R}  ${DIM}${msg}...${R}                    "
      i=$((i+1))
      [ $((i % 16)) -eq 0 ] && mi=$((mi+1))
      sleep 0.12
    done
  ) &
  SPINNER_PID=$!
}

stop_spinner() {
  [ -z "$SPINNER_PID" ] && return
  kill "$SPINNER_PID" 2>/dev/null
  wait "$SPINNER_PID" 2>/dev/null
  SPINNER_PID=""
  printf "\r\033[K"   # erase spinner line
}

event() {
  stop_spinner
  printf "  ${DIM}$(ts)${R}  ${1}${2}${R}  ${BOLD}${3}${R}  ${4}\n"
  start_spinner
}

event_final() {    # print without restarting spinner
  stop_spinner
  printf "  ${DIM}$(ts)${R}  ${1}${2}${R}  ${BOLD}${3}${R}  ${4}\n"
}

# ── File watcher state ────────────────────────────────────────────────────────
touch /tmp/.syn_pm_$$
trap 'stop_spinner; rm -f /tmp/.syn_pm_$$' EXIT
LAST_FILES=0

check_new_files() {
  local cur
  cur=$(find "$PROJECT_DIR" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$cur" -gt "$LAST_FILES" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && event "$YELLOW" "+" "file" "${f#$PROJECT_DIR/}"
    done < <(find "$PROJECT_DIR" -type f ! -path '*/.git/*' ! -name '*.log' ! -name '*.sh' \
        -newer /tmp/.syn_pm_$$ 2>/dev/null | head -10)
    LAST_FILES=$cur
    touch /tmp/.syn_pm_$$
    return 0
  fi
  return 1
}

check_plan_ticks() {
  local PLAN="$PROJECT_DIR/PLAN.md"
  [ ! -f "$PLAN" ] && return
  while IFS= read -r line; do
    case "$line" in
      '[x]'*|'[X]'*)
        local task="${line#\[*\] }"; task="${task% ✓}"; task="${task% (done)}"
        if ! already_shown "plan_$task"; then
          mark_shown "plan_$task"
          event "$GREEN" "✓" "plan" "$task"
        fi
        ;;
    esac
  done < "$PLAN"
}

# ── Core wait loop ────────────────────────────────────────────────────────────
wait_phase() {
  local phase="$1" timeout_secs="$2"; shift 2
  local ids="$*"
  local start; start=$(date +%s)
  local stall=0

  while true; do
    local now; now=$(date +%s)
    local elapsed=$(( now - start ))

    # Hard timeout guardrail
    if [ "$elapsed" -ge "$timeout_secs" ]; then
      event_final "$RED" "⚠" "guardrail" "Phase ${phase} timeout (${timeout_secs}s) — injecting done markers"
      for id in $ids; do
        local upper; upper=$(echo "$id" | tr '[:lower:]' '[:upper:]')
        grep -q "${upper}_P${phase}_DONE" "$BRIDGE" 2>/dev/null || echo "${upper}_P${phase}_DONE" >> "$BRIDGE"
      done
      return 1
    fi

    # Check done markers
    local all_done=1
    for id in $ids; do
      local upper; upper=$(echo "$id" | tr '[:lower:]' '[:upper:]')
      local marker="${upper}_P${phase}_DONE"
      if ! grep -q "$marker" "$BRIDGE" 2>/dev/null; then
        all_done=0
      else
        local key="${upper}_P${phase}_SHOWN"
        eval local _s="\${$key:-0}"
        if [ "$_s" -eq 0 ]; then
          eval "$key=1"
          local col; col=$(cli_col "$id")
          event_final "$col" "✓" "${id^}" "Phase ${phase} complete  (${elapsed}s)"
          start_spinner
        fi
      fi
    done
    [ "$all_done" -eq 1 ] && return 0

    check_plan_ticks

    if check_new_files; then
      stall=0
    else
      stall=$((stall + 1))
      if [ "$stall" -eq "$STALL_WARN" ]; then
        local remaining=$(( timeout_secs - elapsed ))
        event "$YELLOW" "⟳" "health" "CLIs still thinking — no new files for ~64s  (${remaining}s left)"
      fi

      if [ "$stall" -ge "$STALL_KILL" ] && [ "$elapsed" -ge 120 ]; then
        stop_spinner
        printf "\n"
        printf "  ${RED}${BOLD}⚠  No activity for ~5min${R}\n"
        printf "  ${DIM}  [k]${R} Kill phase → inject done markers\n"
        printf "  ${DIM}  [w]${R} Keep waiting (reset counter)\n"
        printf "  ${DIM}  [q]${R} Abort session\n"
        printf "\n  Choice [k/w/q]: "
        local choice; IFS= read -r -t 30 choice || choice="w"
        case "$choice" in
          k|K)
            event_final "$RED" "⚠" "guardrail" "Phase ${phase} skipped — injecting done markers"
            for id in $ids; do
              local upper; upper=$(echo "$id" | tr '[:lower:]' '[:upper:]')
              echo "${upper}_P${phase}_DONE" >> "$BRIDGE"
            done
            return 1 ;;
          q|Q)
            event_final "$RED" "⚠" "guardrail" "Session aborted"
            echo "SESSION_ABORTED" >> "$BRIDGE"
            tmux detach-client 2>/dev/null || true
            exit 1 ;;
          *)
            event "$CYAN" "⟳" "guardrail" "Continuing... (stall reset)"
            stall=0 ;;
        esac
      fi
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
printf "${DIM}  Guardrails: P1=${P1_TIMEOUT}s  P2=${P2_TIMEOUT}s  stall-kill=${STALL_KILL}×8s${R}\n"
divider
printf "\n"

# ── Phase 1 ───────────────────────────────────────────────────────────────────
event_final "$CYAN" "⬡" "synapse" "Phase 1 — ${N_CLIS} CLIs building in parallel"
printf "\n"
start_spinner

wait_phase 1 "$P1_TIMEOUT" $ALL_IDS
P1_RESULT=$?

stop_spinner
printf "\n"
[ "$P1_RESULT" -eq 0 ] \
  && printf "  ${GREEN}${BOLD}⬡  Phase 1 complete!${R}\n" \
  || printf "  ${YELLOW}${BOLD}⬡  Phase 1 ended via guardrail${R}\n"

# ── Show PLAN.md state ────────────────────────────────────────────────────────
PLAN="$PROJECT_DIR/PLAN.md"
if [ -f "$PLAN" ]; then
  printf "\n"
  divider
  printf "${CYAN}${BOLD}  Implementation Plan${R}\n"
  divider
  while IFS= read -r line; do
    case "$line" in
      '[x]'*|'[X]'*) printf "  ${GREEN}✓${R}  ${DIM}${line#\[*\] }${R}\n" ;;
      '[ ]'*|'[-]'*) printf "  ${YELLOW}○${R}  ${line#\[*\] }\n" ;;
    esac
  done < "$PLAN"
  printf "\n"
fi

# ── Guidance collection ────────────────────────────────────────────────────────
divider
printf "${CYAN}${BOLD}  Phase 2 Guidance${R}  ${DIM}(Enter to skip each)${R}\n"
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

# ── Phase 2 ───────────────────────────────────────────────────────────────────
printf "\n"
divider
printf "${CYAN}${BOLD}  Phase 2 — Exchange & Review${R}\n"
divider
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
    printf "  ${DIM}$(ts)${R}  ${col}▶${R}  ${BOLD}${id^}${R}  Phase 2 started\n"
  else
    printf "  ${DIM}$(ts)${R}  ${RED}⚠${R}  ${BOLD}${id^}${R}  Phase 2 script not found\n"
  fi
  _pi=$((_pi+1))
done

printf "\n"
start_spinner
wait_phase 2 "$P2_TIMEOUT" $ALL_IDS

# ── Session complete ───────────────────────────────────────────────────────────
stop_spinner
printf "\n"
divider
printf "${GREEN}${BOLD}  ✓  SESSION COMPLETE${R}\n"
divider
printf "  ${DIM}Project : ${PROJECT_DIR}${R}\n"
printf "  ${DIM}Session : ${SESSION_DIR}${R}\n"
printf "\n"
printf "${DIM}  Press Enter to close this window...${R}"
IFS= read -r _
echo "SESSION_COMPLETE" >> "$BRIDGE"
tmux detach-client -s "$TMUX_SESSION" 2>/dev/null || true
