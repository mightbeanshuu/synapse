#!/bin/bash
# ───────────────────────────────────────────────────────────────────────────
# SYNAPSE Phase Manager — runs inside tmux, controls full session lifecycle
# Args: bridge session_dir project_dir tmux_session n_clis cli_id...
# ───────────────────────────────────────────────────────────────────────────
BRIDGE="$1"; SESSION_DIR="$2"; PROJECT_DIR="$3"
TMUX_SESSION="$4"; N_CLIS="$5"
shift 5

# ── Guardrail timeouts ────────────────────────────────────────────────────────
P1_TIMEOUT=1500   # 25 minutes hard limit for Phase 1
P2_TIMEOUT=1200   # 20 minutes hard limit for Phase 2
STALL_WARN=8      # warn after 8 × 8s = ~64s of no file changes
STALL_KILL=40     # bail after 40 × 8s = ~5min of zero activity AND no markers

# ── Collect CLI IDs (bash 3.2 safe) ──────────────────────────────────────────
CLI_ID_0=""; CLI_ID_1=""; CLI_ID_2=""; _i=0
for _arg in "$@"; do
  case "$_i" in 0) CLI_ID_0="$_arg";; 1) CLI_ID_1="$_arg";; 2) CLI_ID_2="$_arg";; esac
  _i=$((_i+1))
done
ALL_IDS="$CLI_ID_0"
[ -n "$CLI_ID_1" ] && ALL_IDS="$ALL_IDS $CLI_ID_1"
[ -n "$CLI_ID_2" ] && ALL_IDS="$ALL_IDS $CLI_ID_2"

# ── Colors ────────────────────────────────────────────────────────────────────
R=$'\033[0m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
RED=$'\033[31m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; BLUE=$'\033[34m'

ts()      { date +%H:%M:%S; }
event()   { printf "  ${DIM}$(ts)${R}  ${1}${2}${R}  ${BOLD}${3}${R}  ${4}\n"; }
divider() {
  local c; c=$(tput cols 2>/dev/null || echo 80)
  printf "${CYAN}"; printf '%0.s─' $(seq 1 "$c"); printf "${R}\n"
}
cli_col() {
  case "$1" in claude) echo "$CYAN";; gemini) echo "$BLUE";; codex) echo "$GREEN";; *) echo "$R";; esac
}

# ── Pane mapping ──────────────────────────────────────────────────────────────
pane_for() {
  local i="$1"
  if [ "$N_CLIS" -eq 2 ]; then
    case "$i" in 0) echo "0.0";; 1) echo "0.2";; esac
  else
    case "$i" in 0) echo "0.0";; 1) echo "0.2";; 2) echo "0.3";; esac
  fi
}

# ── Shown plan items (bash 3.2 safe via string lookup) ───────────────────────
SHOWN_PLAN="|"
already_shown() { case "$SHOWN_PLAN" in *"|${1}|"*) return 0;; *) return 1;; esac; }
mark_shown()    { SHOWN_PLAN="${SHOWN_PLAN}${1}|"; }

# ── File watcher state ────────────────────────────────────────────────────────
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
    return 0  # had activity
  fi
  return 1    # no new files
}

check_plan_ticks() {
  local PLAN="$PROJECT_DIR/PLAN.md"
  [ ! -f "$PLAN" ] && return
  while IFS= read -r line; do
    case "$line" in
      '[x]'*|'[X]'*)
        task="${line#\[*\] }"; task="${task% ✓}"; task="${task% (done)}"
        if ! already_shown "plan_$task"; then
          mark_shown "plan_$task"
          event "$GREEN" "✓" "plan" "$task"
        fi
        ;;
    esac
  done < "$PLAN"
}

# ── Core wait loop — polls bridge file, enforces timeout, stall-kills ─────────
# Usage: wait_phase <phase_number> <timeout_seconds> <cli_id_list_space_separated>
wait_phase() {
  local phase="$1" timeout_secs="$2"; shift 2
  local ids="$*"
  local start; start=$(date +%s)
  local stall=0

  # Track which markers are already seen
  local seen_key; seen_key="SEEN_P${phase}"

  while true; do
    local now; now=$(date +%s)
    local elapsed=$(( now - start ))

    # ── Hard timeout guardrail ───────────────────────────────────────────────
    if [ "$elapsed" -ge "$timeout_secs" ]; then
      printf "\n"
      event "$RED" "⚠" "guardrail" "Phase ${phase} timeout (${timeout_secs}s). CLIs may be looping."
      event "$RED" "⚠" "guardrail" "Proceeding to next phase — check CLI panes for stuck processes."
      printf "\n"
      # Write synthetic done markers so the session can continue
      for id in $ids; do
        upper=$(echo "$id" | tr '[:lower:]' '[:upper:]')
        marker="${upper}_P${phase}_DONE"
        grep -q "$marker" "$BRIDGE" 2>/dev/null || echo "$marker" >> "$BRIDGE"
      done
      return 1  # timed out
    fi

    # ── Check done markers ───────────────────────────────────────────────────
    local all_done=1
    for id in $ids; do
      upper=$(echo "$id" | tr '[:lower:]' '[:upper:]')
      marker="${upper}_P${phase}_DONE"
      if ! grep -q "$marker" "$BRIDGE" 2>/dev/null; then
        all_done=0
      else
        local key="${upper}_P${phase}_SHOWN"
        eval local _s="\${$key:-0}"
        if [ "$_s" -eq 0 ]; then
          eval "$key=1"
          local col; col=$(cli_col "$id")
          printf "\n"
          event "$col" "✓" "${id^}" "Phase ${phase} complete  (${elapsed}s)"
        fi
      fi
    done
    [ "$all_done" -eq 1 ] && return 0

    # ── Plan ticks ───────────────────────────────────────────────────────────
    check_plan_ticks

    # ── File activity + stall detection ──────────────────────────────────────
    if check_new_files; then
      stall=0
    else
      stall=$((stall + 1))

      if [ "$stall" -eq "$STALL_WARN" ]; then
        local remaining=$(( timeout_secs - elapsed ))
        event "$YELLOW" "⟳" "health" "No new files for ~64s — CLIs still thinking (${remaining}s left)"
      fi

      # Stall-kill guardrail: if nothing happened for STALL_KILL cycles AND
      # more than 2 minutes have already elapsed, consider the CLI stuck
      if [ "$stall" -ge "$STALL_KILL" ] && [ "$elapsed" -ge 120 ]; then
        printf "\n"
        event "$RED" "⚠" "guardrail" "No file or marker activity for ~5min — CLIs may be looping."
        printf "\n"
        printf "  ${RED}${BOLD}Options:${R}\n"
        printf "  ${DIM}  [k]${R} Kill stuck CLIs and skip to next phase\n"
        printf "  ${DIM}  [w]${R} Keep waiting (reset stall counter)\n"
        printf "  ${DIM}  [q]${R} Abort session\n"
        printf "\n  Choice [k/w/q]: "
        local choice
        IFS= read -r -t 30 choice || choice="w"
        case "$choice" in
          k|K)
            event "$RED" "⚠" "guardrail" "Skipping phase ${phase} — injecting done markers."
            for id in $ids; do
              upper=$(echo "$id" | tr '[:lower:]' '[:upper:]')
              echo "${upper}_P${phase}_DONE" >> "$BRIDGE"
            done
            return 1
            ;;
          q|Q)
            event "$RED" "⚠" "guardrail" "Session aborted by user."
            echo "SESSION_ABORTED" >> "$BRIDGE"
            tmux detach-client 2>/dev/null || true
            exit 1
            ;;
          *)
            event "$CYAN" "⟳" "guardrail" "Continuing to wait... (stall counter reset)"
            stall=0
            ;;
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
printf "${DIM}  Guardrails: P1 timeout=${P1_TIMEOUT}s  P2 timeout=${P2_TIMEOUT}s  stall-kill=${STALL_KILL} cycles${R}\n"
divider
printf "\n"

# ── Phase 1 ───────────────────────────────────────────────────────────────────
event "$CYAN" "⬡" "synapse" "Phase 1 — ${N_CLIS} CLIs building in parallel"
printf "\n"

wait_phase 1 "$P1_TIMEOUT" $ALL_IDS
P1_RESULT=$?

printf "\n"
[ "$P1_RESULT" -eq 0 ] && event "$GREEN" "⬡" "synapse" "Phase 1 done!" \
                        || event "$YELLOW" "⬡" "synapse" "Phase 1 ended (timeout/guardrail triggered)"

# ── Show final plan state ──────────────────────────────────────────────────────
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
  else
    event "$RED" "⚠" "${id^}" "Phase 2 script not found — skipping"
  fi
  _pi=$((_pi+1))
done

printf "\n"
wait_phase 2 "$P2_TIMEOUT" $ALL_IDS

# ── Session complete ───────────────────────────────────────────────────────────
printf "\n"
divider
printf "${GREEN}${BOLD}  ✓  SESSION COMPLETE${R}\n"
divider
printf "  ${DIM}Project : ${PROJECT_DIR}${R}\n"
printf "  ${DIM}Session : ${SESSION_DIR}${R}\n"
printf "\n"
printf "${DIM}  Press Enter to detach and see summary...${R}"
IFS= read -r _
echo "SESSION_COMPLETE" >> "$BRIDGE"
tmux detach-client 2>/dev/null || true
