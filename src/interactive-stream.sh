#!/bin/bash
# SYNAPSE Interactive Stream & Chat Wrapper
# Usage: ./interactive-stream.sh <cli_id> <symbol> <log_p1> <log_p2> <pipe_path>

CLI_ID="$1"
SYMBOL="$2"
LOG_P1="$3"
LOG_P2="$4"
PIPE="$5"

# Colors
R=$'\033[0m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; TEAL=$'\033[38;5;51m'

clear
printf "\n${TEAL}${BOLD}  ⬡  SYNAPSE Chat — ${CLI_ID}${R}\n"
printf "${DIM}  (Type a message to steer this agent in real-time)${R}\n"
printf "${DIM}  Logs will stream below...${R}\n\n"

# Ensure logs exist
touch "$LOG_P1" "$LOG_P2"

# ── 1. Tail logs in the background ──────────────────────────────────────────
(
  tail -n 40 -F "$LOG_P1" "$LOG_P2" 2>/dev/null | while IFS= read -r line; do
    # Only print non-empty lines to keep it clean
    [ -n "$line" ] && printf "  %s\n" "$line"
  done
) &
TAIL_PID=$!

# Cleanup on exit
trap "kill $TAIL_PID 2>/dev/null; exit" EXIT INT TERM

# ── 2. Read loop for chat ────────────────────────────────────────────────────
while true; do
  # Position prompt at the bottom or just keep it scrolling
  printf "\n${BLUE}${BOLD}[Chat ${SYMBOL}]${R} > "
  if IFS= read -r user_msg; then
    if [ -n "$user_msg" ]; then
      # Send to the command pipe
      echo "/ask ${CLI_ID} ${user_msg}" >> "$PIPE"
      printf "${DIM}  (Message sent to ${CLI_ID}...)${R}\n"
    fi
  fi
done
