#!/bin/bash
# Window-tracking spike: answers open questions A, B, D, E, F, G from the
# research round on a real Mac. Throwaway — deleted once the findings are
# written into WCs/WC__window-tracking.md.
#
# Run from Terminal.app (not VS Code's terminal):  bash spikes/window-tracking/run.sh
# Run only some sections by naming them:           bash spikes/window-tracking/run.sh A D1
# Sections: B A G E D1 D2 F S1 S2 T H (or H_url / H_profile_only) C
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
  LAST_ANSWER=$answer
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

# First id that is new in the system-wide list AND visible to AX — apps
# create invisible helper windows (Chrome makes several per window), so
# a bare "new id" can be the wrong one.
new_real_window() {
  local bundle=$1 before=$2 fresh ax id
  fresh=$(new_ids "$before" "$("$PROBE" cgids "$bundle")")
  ax=$("$PROBE" ids "$bundle")
  for id in $fresh; do
    case " $ax " in *" $id "*) echo "$id"; return ;; esac
  done
}

# Opens a throwaway TextEdit document, sets TEXT_WINDOW to its window id.
open_test_document() {
  local before
  before=$("$PROBE" cgids com.apple.TextEdit 2>/dev/null | grep -v ERROR)
  echo "window-tracking spike test document" >"$WORK/wt-$1.txt"
  open -a TextEdit "$WORK/wt-$1.txt"
  sleep 3
  TEXT_WINDOW=$(new_real_window com.apple.TextEdit "$before")
  echo "OPENED TextEdit window=${TEXT_WINDOW:-none} (title: wt-$1.txt)"
}

if want S1 || want S2; then
  pause "Quit TextEdit if it's open (Cmd+Q), so no leftover windows affect the test."
  echo
  echo "SETTING 'switch to a Space with open windows' = $(defaults read com.apple.dock workspaces-auto-swoosh 2>/dev/null || echo 'not set (default: on)')"
fi

if want S1; then
  section "S1: window moved to another desktop — reachable through a reference held from before the move?"
  open_test_document s1
  [ -n "$TEXT_WINDOW" ] && "$PROBE" spaces-held com.apple.TextEdit "$TEXT_WINDOW" </dev/tty
fi

if want S2; then
  section "S2: window on another desktop, looked up fresh (as after an app restart)"
  open_test_document s2
  if [ -n "$TEXT_WINDOW" ]; then
    pause "Open Mission Control (Ctrl+Up), drag the 'wt-s2.txt' window onto ANOTHER desktop, then click back onto THIS desktop."
    "$PROBE" spaces-fresh com.apple.TextEdit "$TEXT_WINDOW" </dev/tty
  fi
fi

if want T; then
  section "T: how do Terminal tabs show up?"
  open_test_terminal t
  BEFORE_TAB=$("$PROBE" cgids com.apple.Terminal)
  pause "Click the new test Terminal window (running sleep), press Cmd+T to add a tab, then click back here."
  NEW_TAB=$(new_ids "$BEFORE_TAB" "$("$PROBE" cgids com.apple.Terminal)")
  echo "TAB new_system_window_ids=${NEW_TAB:-none} (a tab with its own id = tabs are separate windows)"
  PATTERN=$(echo "$TEST_WINDOW $NEW_TAB" | tr -s ' ' '|' | sed 's/^|//;s/|$//')
  "$PROBE" windows com.apple.Terminal | grep -E "id=($PATTERN) "
  kill_test_processes
  pause "Close the test window and its tab yourself (Cmd+W on each; no dialog should appear)."
fi

if want H || want H_url || want H_profile_only; then
  section "H: Chrome — does 'open -n' with a profile create a new window, and can we catch its id?"
  if open -Ra "Google Chrome" 2>/dev/null; then
    echo "CHROME_RUNNING_BEFORE $(pgrep -xq 'Google Chrome' && echo yes || echo no)"
    for variant in url profile_only; do
      want H || want "H_$variant" || continue
      BEFORE_CH=$("$PROBE" cgids com.google.Chrome 2>/dev/null | grep -v ERROR)
      if [ "$variant" = url ]; then
        open -n -a "Google Chrome" --args --profile-directory=Default "https://example.com/?window-tracking-spike"
      else
        open -n -a "Google Chrome" --args --profile-directory=Default
      fi
      sleep 5
      NEW_CH=$(new_real_window com.google.Chrome "$BEFORE_CH")
      echo "CHROME_$variant new_real_window=${NEW_CH:-none}"
      ask "($variant) Did Chrome open a NEW WINDOW (not just a new tab in an existing one)?" "H_${variant}_new_window"
      if [ -n "$NEW_CH" ]; then
        "$PROBE" close com.google.Chrome "$NEW_CH"
        sleep 1
        echo "AFTER_CLOSE window_exists=$(window_exists "$NEW_CH")"
        ask "Did that Chrome window actually close?" "H_${variant}_closed"
      else
        pause "Close the new Chrome tab/window yourself."
      fi
    done
  else
    echo "SKIPPED Google Chrome not installed"
  fi
fi

# Builds WTHost.app (ad-hoc signed) with the probe inside it twice: as a
# plain child executable (Contents/Helpers/probe) and as its own helper
# app (Contents/Helpers/WTHelper.app). Built once and kept — rebuilding
# changes the signature, which invalidates an Accessibility grant.
HOST_APP="$DIR/build/WTHost.app"
HOST_ID=com.workspacelauncher.spike.host

write_plist() {
  cat >"$1" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$2</string>
  <key>CFBundleName</key><string>$3</string>
  <key>CFBundleExecutable</key><string>$4</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Window-tracking spike test.</string>
</dict></plist>
EOF
}

build_host_app() {
  [ -d "$HOST_APP" ] && { echo "HOST_APP reusing existing build"; return; }
  local helper="$HOST_APP/Contents/Helpers/WTHelper.app"
  mkdir -p "$HOST_APP/Contents/MacOS" "$helper/Contents/MacOS"
  cp "$PROBE" "$HOST_APP/Contents/MacOS/host"
  cp "$PROBE" "$HOST_APP/Contents/Helpers/probe"
  cp "$PROBE" "$helper/Contents/MacOS/helper"
  write_plist "$HOST_APP/Contents/Info.plist" "$HOST_ID" WTHost host
  write_plist "$helper/Contents/Info.plist" com.workspacelauncher.spike.helper WTHelper helper
  codesign --force -s - "$HOST_APP/Contents/Helpers/probe"
  codesign --force -s - "$helper"
  codesign --force -s - "$HOST_APP"
  echo "HOST_APP built at $HOST_APP"
}

run_host() {
  rm -f "$WORK/host-$1.txt"
  open -W -n "$HOST_APP" --args host "$WORK/host-$1.txt"
  cat "$WORK/host-$1.txt" 2>/dev/null || echo "HOST produced no output"
}

if want C; then
  section "C + A-as-app: does a helper share the app's Accessibility grant? does quit stay prompt-free?"
  build_host_app
  echo "--- round 1: WTHost NOT granted (baseline, everything should say not trusted) ---"
  tccutil reset Accessibility "$HOST_ID" >/dev/null 2>&1
  run_host 1
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
  open -R "$HOST_APP"
  pause "In Accessibility settings, add WTHost (drag it from the Finder window that opened, or use +) and switch it ON. Do NOT add WTHelper."
  echo "--- round 2: only WTHost granted ---"
  start_tcc_log C
  run_host 2
  stop_tcc_log C
  ask "Did any '... wants to control Calculator' dialog appear?" C_terminate_prompt_shown
  ask "Remove WTHost from Accessibility now (recommended)?" C_cleanup
  [ "$LAST_ANSWER" = y ] && tccutil reset Accessibility "$HOST_ID" && echo "CLEANUP done"
fi

rm -rf "$WORK"
echo
echo "Done. Results saved to $OUT"
