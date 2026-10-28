// Throwaway spike probe for WC__window-tracking.md's open questions.
// Not product code — compiled and driven by run.sh, deleted once the
// findings are written up.
//
// Subcommands:
//   trusted                      Is the calling process Accessibility-trusted?
//   windows <bundleId>           List AX windows + CGWindowList entries for the app
//   ids <bundleId>               Space-separated CGWindowIDs of the app's AX windows
//   exists <windowId>            Is the window in the system-wide window list?
//   cgids <bundleId>             Space-separated ids of the app's windows in the system-wide list
//   spaces-held <bundleId> <id>  Grab the AX window now, let the user move it to another Space,
//                                then check visibility, focus and close via the held reference
//   spaces-fresh <bundleId> <id> Look the window up from scratch (as after an app restart),
//                                activate the app, check whether it became reachable, close it
//   close <bundleId> <windowId>  Press the window's close button via AX, report outcome
//   terminate <bundleId>         NSRunningApplication.terminate(), report outcome

import AppKit
import ApplicationServices

@_silgen_name("_AXUIElementGetWindow")
func axGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

func fail(_ message: String) -> Never {
  print("ERROR \(message)")
  exit(1)
}

func app(_ bundleId: String) -> NSRunningApplication {
  guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
  else { fail("not running: \(bundleId)") }
  return app
}

func attr<T>(_ element: AXUIElement, _ name: String) -> T? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
    return nil
  }
  return value as? T
}

func axWindows(_ pid: pid_t) -> [AXUIElement] {
  attr(AXUIElementCreateApplication(pid), kAXWindowsAttribute) ?? []
}

func windowId(_ window: AXUIElement) -> CGWindowID? {
  var id: CGWindowID = 0
  return axGetWindow(window, &id) == .success ? id : nil
}

// The AX window list drops windows on other Spaces and windows with an
// attached sheet, so "gone from AX" doesn't mean closed — check the
// system-wide window list instead.
func cgWindowExists(_ id: CGWindowID) -> Bool {
  let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  return info.contains { ($0[kCGWindowNumber as String] as? Int) == Int(id) }
}

// NSRunningApplication.isTerminated only refreshes via the run loop,
// which this CLI never spins — ask the kernel directly.
func processAlive(_ pid: pid_t) -> Bool {
  kill(pid, 0) == 0
}

func cgWindows(_ pid: pid_t) -> [[String: Any]] {
  let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  return info.filter {
    ($0[kCGWindowOwnerPID as String] as? pid_t) == pid && ($0[kCGWindowLayer as String] as? Int) == 0
  }
}

func axWindow(_ pid: pid_t, _ id: CGWindowID) -> AXUIElement? {
  axWindows(pid).first { windowId($0) == id }
}

func activate(_ app: NSRunningApplication) {
  if #available(macOS 14, *) {
    app.activate()
  } else {
    app.activate(options: [])
  }
}

// Launch Services activation (what `open -b` / a Dock click does) — the
// path the product itself uses, and not subject to the activate()
// refusal a non-app CLI process can get.
func openApp(_ bundleId: String) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  process.arguments = ["-b", bundleId]
  try? process.run()
  process.waitUntilExit()
}

func askYesNo(_ question: String, _ key: String) {
  print("\(question) [y/n]")
  print("ANSWER \(key): \(readLine() ?? "")")
}

func waitForEnter(_ prompt: String) {
  print("\(prompt) (press Enter)")
  _ = readLine()
}

func pressClose(_ window: AXUIElement) -> String {
  guard let button: AXUIElement = attr(window, kAXCloseButtonAttribute) else { return "no_button" }
  let result = AXUIElementPerformAction(button, kAXPressAction as CFString)
  return result == .success ? "success" : "error \(result.rawValue)"
}

func hasSheet(_ window: AXUIElement) -> Bool {
  let children: [AXUIElement] = attr(window, kAXChildrenAttribute) ?? []
  return children.contains { (attr($0, kAXRoleAttribute) as String?) == "AXSheet" }
}

// run.sh pipes output through tee; unbuffered so prompts show before readLine blocks.
setvbuf(stdout, nil, _IONBF, 0)

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: probe <subcommand> [args]") }

switch args[1] {
case "trusted":
  print(AXIsProcessTrusted() ? "TRUSTED yes" : "TRUSTED no")

case "windows":
  guard args.count == 3 else { fail("usage: windows <bundleId>") }
  let target = app(args[2])
  let windows = axWindows(target.processIdentifier)
  print("AX_WINDOW_COUNT \(windows.count)")
  for window in windows {
    let id = windowId(window).map(String.init) ?? "FAILED"
    let title: String = attr(window, kAXTitleAttribute) ?? "<none>"
    let minimized: Bool = attr(window, kAXMinimizedAttribute) ?? false
    print("AX_WINDOW id=\(id) minimized=\(minimized) title=\(title)")
  }
  let info =
    CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  for entry in info where (entry[kCGWindowOwnerPID as String] as? pid_t) == target.processIdentifier
    && (entry[kCGWindowLayer as String] as? Int) == 0
  {
    let number = entry[kCGWindowNumber as String] as? Int ?? -1
    let hasName = entry[kCGWindowName as String] != nil
    let hasOwnerName = entry[kCGWindowOwnerName as String] != nil
    let onscreen = entry[kCGWindowIsOnscreen as String] as? Bool ?? false
    print(
      "CG_WINDOW id=\(number) onscreen=\(onscreen) name_visible=\(hasName) owner_name_visible=\(hasOwnerName)"
    )
  }

case "cgids":
  guard args.count == 3 else { fail("usage: cgids <bundleId>") }
  let ids = cgWindows(app(args[2]).processIdentifier).compactMap {
    $0[kCGWindowNumber as String] as? Int
  }
  print(ids.map(String.init).joined(separator: " "))

case "spaces-held":
  guard args.count == 4, let id = CGWindowID(args[3]) else {
    fail("usage: spaces-held <bundleId> <windowId>")
  }
  let target = app(args[2])
  let pid = target.processIdentifier
  guard let held = axWindow(pid, id) else { fail("window \(id) not visible to AX at start") }
  print("HELD reference captured")
  waitForEnter(
    "Open Mission Control (Ctrl+Up), drag the test window onto ANOTHER desktop (add one with + if needed), then click back onto THIS desktop."
  )
  let title: String? = attr(held, kAXTitleAttribute)
  print("AFTER_MOVE fresh_ax_listed=\(axWindow(pid, id) != nil) cg_exists=\(cgWindowExists(id))")
  print("AFTER_MOVE held_reference_alive=\(title != nil)")
  waitForEnter("Next: the probe will try to FOCUS the window via the held reference.")
  let raise = AXUIElementPerformAction(held, kAXRaiseAction as CFString)
  openApp(args[2])
  print("FOCUS raise_result=\(raise == .success ? "success" : "error \(raise.rawValue)") then open -b")
  askYesNo("Did the screen switch to the other desktop and show the window?", "S1_focus_switched_desktop")
  waitForEnter("Return to THIS desktop if you were moved.")
  print("CLOSE press=\(pressClose(held))")
  Thread.sleep(forTimeInterval: 3)
  print("CLOSE_OUTCOME window_exists=\(cgWindowExists(id))")

case "spaces-fresh":
  guard args.count == 4, let id = CGWindowID(args[3]) else {
    fail("usage: spaces-fresh <bundleId> <windowId>")
  }
  let target = app(args[2])
  let pid = target.processIdentifier
  print("FRESH before_activate ax_listed=\(axWindow(pid, id) != nil) cg_exists=\(cgWindowExists(id))")
  activate(target)
  Thread.sleep(forTimeInterval: 2)
  var found = axWindow(pid, id)
  print("FRESH after_activate_api ax_listed=\(found != nil)")
  askYesNo("Did the screen switch desktops just now?", "S2_activate_api_switched")
  waitForEnter("Return to THIS desktop if you were moved.")
  if found == nil {
    openApp(args[2])
    Thread.sleep(forTimeInterval: 2)
    found = axWindow(pid, id)
    print("FRESH after_open_b ax_listed=\(found != nil)")
    askYesNo("Did the screen switch desktops this time?", "S2_open_b_switched")
    waitForEnter("Return to THIS desktop if you were moved.")
  }
  if let found {
    print("CLOSE press=\(pressClose(found))")
    Thread.sleep(forTimeInterval: 3)
    print("CLOSE_OUTCOME window_exists=\(cgWindowExists(id))")
  } else {
    print("CLOSE skipped — window still not reachable through AX")
  }

case "ids":
  guard args.count == 3 else { fail("usage: ids <bundleId>") }
  let ids = axWindows(app(args[2]).processIdentifier).compactMap(windowId)
  print(ids.map(String.init).joined(separator: " "))

case "exists":
  guard args.count == 3, let id = CGWindowID(args[2]) else { fail("usage: exists <windowId>") }
  print(cgWindowExists(id) ? "yes" : "no")

case "close":
  guard args.count == 4, let target = CGWindowID(args[3]) else {
    fail("usage: close <bundleId> <windowId>")
  }
  let pid = app(args[2]).processIdentifier
  guard let window = axWindows(pid).first(where: { windowId($0) == target }) else {
    fail("window \(target) not found")
  }
  print("PRESS_RESULT \(pressClose(window))")
  Thread.sleep(forTimeInterval: 2)
  let axListed = axWindows(pid).first(where: { windowId($0) == target })
  let sheet = axListed.map(hasSheet).map(String.init) ?? "unknown"
  print(
    "CLOSE_OUTCOME window_exists=\(cgWindowExists(target)) ax_listed=\(axListed != nil) sheet_shown=\(sheet)"
  )

case "terminate":
  guard args.count == 3 else { fail("usage: terminate <bundleId>") }
  let target = app(args[2])
  let pid = target.processIdentifier
  print("TERMINATE_RETURNED \(target.terminate())")
  for _ in 0..<50 where processAlive(pid) {
    Thread.sleep(forTimeInterval: 0.1)
  }
  print("TERMINATE_OUTCOME \(processAlive(pid) ? "still_running" : "quit")")

default:
  fail("unknown subcommand \(args[1])")
}
