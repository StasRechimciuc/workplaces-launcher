import ApplicationServices
import Foundation

// wl-helper: Workspace Launcher's native window/app helper (see
// WCs/WC__window-tracking.md, "Native helper"). Always runs as a child
// process of the main app, never launched on its own — a child
// inherits the app's Accessibility grant, a separately launched helper
// would need (and clutter System Settings with) a second one
// (finding C).
//
//   wl-helper serve   Persistent JSON-lines RPC over stdin/stdout.
//   wl-helper trust   One-shot permission check: prints {"trusted":bool}.

/// Accessibility trust, read from a freshly spawned process — a
/// long-running one can keep reporting a stale `true` after the app is
/// removed from the Accessibility list. The flag alone isn't trusted
/// either: a real AX call failing with kAXErrorAPIDisabled overrides
/// it. That call is also what makes macOS add the app to the
/// Accessibility list (switched off) on first run, so the user only has
/// to flip the switch.
func checkTrust() -> Bool {
  var value: CFTypeRef?
  let call = AXUIElementCopyAttributeValue(
    AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as CFString, &value)
  return AXIsProcessTrusted() && call != .apiDisabled
}

switch CommandLine.arguments.dropFirst().first {
case "serve":
  Server().run()
case "trust":
  write(["trusted": checkTrust()])
default:
  FileHandle.standardError.write(Data("usage: wl-helper serve | wl-helper trust\n".utf8))
  exit(64)
}
