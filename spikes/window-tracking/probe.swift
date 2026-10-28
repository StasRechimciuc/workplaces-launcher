// Throwaway spike probe for WC__window-tracking.md's open questions.
// Not product code — compiled and driven by run.sh, deleted once the
// findings are written up.
//
// Subcommands:
//   trusted                      Is the calling process Accessibility-trusted?
//   windows <bundleId>           List AX windows + CGWindowList entries for the app
//   ids <bundleId>               Space-separated CGWindowIDs of the app's AX windows
//   exists <windowId>            Is the window in the system-wide window list?
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

func hasSheet(_ window: AXUIElement) -> Bool {
  let children: [AXUIElement] = attr(window, kAXChildrenAttribute) ?? []
  return children.contains { (attr($0, kAXRoleAttribute) as String?) == "AXSheet" }
}

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
    print("CG_WINDOW id=\(number) name_visible=\(hasName) owner_name_visible=\(hasOwnerName)")
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
  guard let button: AXUIElement = attr(window, kAXCloseButtonAttribute) else {
    fail("window \(target) has no close button")
  }
  let pressed = AXUIElementPerformAction(button, kAXPressAction as CFString)
  print("PRESS_RESULT \(pressed == .success ? "success" : "error \(pressed.rawValue)")")
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
