#!/bin/bash
# Window-tracking spike: answers open questions A, B, D, E, F, G from the
# research round on a real Mac. Throwaway — deleted once the findings are
# written into WCs/WC__window-tracking.md.
#
# Run from Terminal.app (not VS Code's terminal):  bash spikes/window-tracking/run.sh
# Run only some sections by naming them:           bash spikes/window-tracking/run.sh A D1
# Needs: Xcode command-line tools (swiftc), Accessibility granted to the
# terminal app you run it from. Opens/closes Calculator, a few Terminal
# windows running `sleep`, and one VS Code test window. Results are
# written to spikes/window-tracking/results.txt.

set -u
DIR=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
OUT="$DIR/results.txt"
exec > >(tee "$OUT") 2>&1

ONLY="$*"
want() {
  [ -z "$ONLY" ] && return 0
  case " $ONLY " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}
section() { echo; echo "=== $1 ==="; }
ask() {
  local answer
  read -r -p "$1 [y/n] " answer </dev/tty
  echo "ANSWER $2: $answer"
}
pause() { read -r -p "$1 (press Enter) " _ </dev/tty; }

TCC_PID=""
start_tcc_log() {
  log stream --style compact --predicate 'subsystem == "com.apple.TCC"' >"$WORK/tcc-$1.log" 2>&1 &
  TCC_PID=$!
  sleep 2
}
stop_tcc_log() {
  sleep 2
  kill "$TCC_PID" 2>/dev/null
  wait "$TCC_PID" 2>/dev/null
  echo "TCC_APPLEEVENTS_LINES $(grep -c 'AppleEvents' "$WORK/tcc-$1.log")"
  grep 'AppleEvents' "$WORK/tcc-$1.log" | head -5
}

# Prints ids present in $2 but not in $1 (both space-separated lists).
new_ids() {
  local id result=""
  for id in $2; do
    case " $1 " in *" $id "*) ;; *) result="$result $id" ;; esac
  done
  echo $result
}

# Opens a .command running `sleep 600` in Terminal, waits for it to start.
# Sets TEST_TTY, TEST_PID, TEST_WINDOW (empty if no new window appeared).
open_test_terminal() {
  local name=$1 before after i
  before=$("$PROBE" ids com.apple.Terminal)
  cat >"$WORK/$name.command" <<EOF
#!/bin/bash
echo "\$(tty) \$\$" > "$WORK/$name.info"
sleep 600
EOF
  chmod +x "$WORK/$name.command"
  open -a Terminal "$WORK/$name.command"
  for i in $(seq 1 30); do
    [ -s "$WORK/$name.info" ] && break
    sleep 0.5
  done
  sleep 1
  read -r TEST_TTY TEST_PID <"$WORK/$name.info"
  after=$("$PROBE" ids com.apple.Terminal)
  TEST_WINDOW=$(new_ids "$before" "$after" | awk '{print $1}')
  echo "OPENED tty=$TEST_TTY shell_pid=$TEST_PID new_window=${TEST_WINDOW:-none}"
}

kill_test_processes() {
  pkill -P "$TEST_PID" 2>/dev/null
  kill "$TEST_PID" 2>/dev/null
  sleep 2
}

# System-wide window list, not AX: AX drops windows that have a sheet
# attached or live on another Space.
window_exists() { "$PROBE" exists "$1"; }

section "Environment"
sw_vers
uname -m
echo "TERM_PROGRAM ${TERM_PROGRAM:-unknown}"

command -v swiftc >/dev/null || { echo "swiftc missing — run: xcode-select --install"; exit 1; }
PROBE="$WORK/probe"
swiftc -O "$DIR/probe.swift" -o "$PROBE" || { echo "probe failed to compile"; exit 1; }

if [ "$("$PROBE" trusted)" != "TRUSTED yes" ]; then
  echo "Accessibility is not granted to ${TERM_PROGRAM:-your terminal app}."
  echo "Enable it in the System Settings pane that just opened, then rerun this script."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
  exit 1
fi
echo "ACCESSIBILITY granted"

if want B; then
  section "B: does 'application \"X\" is running' trigger an Automation prompt?"
  open -a Calculator
  sleep 2
  start_tcc_log B
  osascript -e 'application "Calculator" is running'
  stop_tcc_log B
  ask "Did a dialog '... wants to control Calculator' appear?" B_prompt_shown
fi

if want A; then
  section "A: does NSRunningApplication.terminate() trigger an Automation prompt?"
  open -a Calculator
  sleep 2
  start_tcc_log A
  "$PROBE" terminate com.apple.calculator
  stop_tcc_log A
  ask "Did a dialog '... wants to control Calculator' appear?" A_prompt_shown
  ask "Did Calculator actually close on screen?" A_calculator_closed
fi

if want G; then
  section "G: does _AXUIElementGetWindow give window ids? (+ what CGWindowList exposes)"
  open -a Terminal
  sleep 1
  "$PROBE" windows com.apple.Terminal
fi

E1_WINDOW=""
if want E; then
  section "E: does 'open -a Terminal x.command' open a new window or a tab?"
  open_test_terminal e1
  E1_WINDOW=$TEST_WINDOW
  ask "Did it open as a new WINDOW (not a tab in an existing window)?" E_new_window
fi

if want D1; then
  section "D1: close a Terminal window via AX while its command is still running"
  if [ -z "$E1_WINDOW" ]; then
    open_test_terminal d1
    E1_WINDOW=$TEST_WINDOW
  fi
  if [ -n "$E1_WINDOW" ]; then
    "$PROBE" close com.apple.Terminal "$E1_WINDOW"
    ask "Did Terminal show a 'terminate running processes?' dialog?" D1_dialog_shown
    kill_test_processes
    echo "AFTER_KILL window_exists=$(window_exists "$E1_WINDOW")"
    pause "If a Terminal dialog is still showing, dismiss it (Terminate/Beenden)."
  else
    echo "SKIPPED no new window to close (opened as tab?)"
    kill_test_processes
  fi
elif [ -n "$E1_WINDOW" ]; then
  kill_test_processes
fi

if want D2; then
  section "D2: kill the command first, then close the window via AX"
  open_test_terminal d2
  if [ -n "$TEST_WINDOW" ]; then
    kill_test_processes
    EXISTS=$(window_exists "$TEST_WINDOW")
    echo "AFTER_KILL window_exists=$EXISTS (no = Terminal auto-closes when the shell exits)"
    if [ "$EXISTS" = yes ]; then
      "$PROBE" close com.apple.Terminal "$TEST_WINDOW"
      ask "Did any dialog appear this time?" D2_dialog_shown
    fi
  else
    echo "SKIPPED no new window"
    kill_test_processes
  fi
fi

if want F; then
  section "F: can an extension close its own VS Code window?"
  CODE_CLI=$(command -v code || echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")
  if [ -x "$CODE_CLI" ]; then
    MARKER="$DIR/vscode-close-test/.marker"
    rm -f "$MARKER"
    BEFORE_VS=$("$PROBE" ids com.microsoft.VSCode 2>/dev/null | grep -v ERROR)
    "$CODE_CLI" --new-window --extensionDevelopmentPath="$DIR/vscode-close-test"
    for i in $(seq 1 80); do
      [ -f "$MARKER" ] && break
      sleep 0.5
    done
    if [ -f "$MARKER" ]; then
      sleep 4
      REMAINING=$(new_ids "$BEFORE_VS" "$("$PROBE" ids com.microsoft.VSCode)")
      echo "CLOSE_INVOKED yes; new windows still open: ${REMAINING:-none}"
    else
      echo "CLOSE_INVOKED no (extension never activated within 40s)"
    fi
    ask "Did the [Extension Development Host] window open and then close by itself?" F_window_closed
    rm -f "$MARKER"
  else
    echo "SKIPPED VS Code CLI not found"
  fi
fi

if want C; then
  section "C: does a helper launched by the app share its Accessibility grant?"
  echo "NOT TESTED here — only meaningful in a signed, packaged build. Deferred to the Stage 2 spike."
fi

rm -rf "$WORK"
echo
echo "Done. Results saved to $OUT"
