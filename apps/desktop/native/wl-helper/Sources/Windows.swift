import AppKit
import ApplicationServices

// Private, undocumented, but the only way to get a window's system-wide
// id from an Accessibility element — the same call window managers
// (yabai, AltTab-style tools) rely on. Verified on macOS 26.6 by the
// window-tracking spike (finding G). If a future macOS breaks it, the
// documented fallback is matching by title + size + position.
@_silgen_name("_AXUIElementGetWindow")
private func axGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

/// One Accessibility-visible window, as reported to the client.
struct WindowInfo {
  let id: CGWindowID
  let pid: pid_t
  let title: String
  let minimized: Bool
  /// `AXStandardWindow` — false for panels, popovers and the invisible
  /// helper windows Chrome creates (finding H), which must never be
  /// mistaken for a step's window.
  let standard: Bool
  /// Position and size on screen — what matches a window to the one a
  /// browser's scripting interface reports (Phase 4 spike: identical).
  let frame: CGRect?

  var json: JSONObject {
    var json: JSONObject = [
      "windowId": id, "pid": pid, "title": title, "minimized": minimized, "standard": standard,
    ]
    if let frame {
      json["frame"] = [
        "x": Int(frame.origin.x), "y": Int(frame.origin.y),
        "width": Int(frame.size.width), "height": Int(frame.size.height),
      ]
    }
    return json
  }
}

/// Accessibility references for windows this helper has already found.
///
/// A reference obtained while a window was visible keeps working after
/// the window moves to another desktop, while a fresh lookup can't see
/// it at all (findings S1/S2) — which is why the helper is a persistent
/// process rather than one spawned per call: these references only
/// live in the process that created them.
private struct HeldWindow {
  let pid: pid_t
  /// The process's kernel start time when the reference was taken — a
  /// reused pid is a different process.
  let startedAt: Int64?
  let element: AXUIElement
}

final class WindowRegistry {
  private var held: [CGWindowID: HeldWindow] = [:]
  /// Windows whose held reference stopped resolving. That's the
  /// definitive "closed" signal, and it has to be remembered: the
  /// system window list keeps a just-closed window for a while (seen
  /// with TextEdit, and finding H for Chrome), so falling back to it
  /// would report the window alive again on the next call.
  private var gone: Set<CGWindowID> = []

  /// Strict: an app that's running but whose windows can't be read is
  /// an error here, never an empty list — an empty list reads as "no
  /// windows open", and callers act on that (it once made the user's
  /// window look new). Capturing keeps its own lenient read: it polls.
  func listWindows(bundleId: String) throws -> [WindowInfo] {
    try runningApps(bundleId).flatMap { app in
      let windows: [AXUIElement] =
        try attribute(AXUIElementCreateApplication(app.processIdentifier), kAXWindowsAttribute) ?? []
      return windows.compactMap { info($0, pid: app.processIdentifier) }
    }
  }

  /// Waits for exactly one new standard window of `bundleId` that isn't
  /// in `before` (the snapshot the client took just before opening
  /// it), then holds its reference. Once a candidate shows up it waits
  /// a short settle period and looks again, so two windows appearing in
  /// quick succession are reported as ambiguous rather than one of them
  /// being silently picked.
  /// `titleContains` narrows the candidates to windows whose title has
  /// that text — a per-terminal marker the opener set, so one step
  /// opening several windows at once still captures each one exactly.
  func captureNewWindow(
    bundleId: String, before: Set<CGWindowID>, titleContains: String?, timeout: TimeInterval
  ) throws -> WindowInfo {
    let deadline = Date().addingTimeInterval(timeout)
    var lastTimeout: RpcError?
    func candidates() throws -> [(WindowInfo, AXUIElement)] {
      try runningApps(bundleId).flatMap { app -> [(WindowInfo, AXUIElement)] in
        // An app that's still launching doesn't answer Accessibility
        // yet (seen on a real TextEdit launch) — "no window yet" for
        // this round, not a failure, unless it never starts answering.
        let elements: [AXUIElement]
        do {
          elements = try axWindows(app.processIdentifier)
          lastTimeout = nil
        } catch let error as RpcError where error.code == "ax-timeout" {
          lastTimeout = error
          return []
        }
        return elements.compactMap { element in
          guard let window = info(element, pid: app.processIdentifier),
            window.standard, !before.contains(window.id),
            titleContains.map({ window.title.contains($0) }) ?? true
          else { return nil }
          return (window, element)
        }
      }
    }

    while Date() < deadline {
      if try !candidates().isEmpty {
        Thread.sleep(forTimeInterval: 0.25)
        let settled = try candidates()
        if settled.count > 1 {
          let ids = settled.map { String($0.0.id) }.joined(separator: ", ")
          throw RpcError(
            code: "ambiguous",
            message: "\(settled.count) new \(bundleId) windows appeared (\(ids)); none was captured")
        }
        if let (window, element) = settled.first {
          hold(window.id, pid: window.pid, element)
          return window
        }
      }
      Thread.sleep(forTimeInterval: 0.1)
    }
    if let lastTimeout { throw lastTimeout }
    throw RpcError(
      code: "not-found",
      message: "No new \(bundleId) window appeared within \(Int(timeout * 1000))ms")
  }

  /// "Gone" is decided by the held reference no longer resolving, not
  /// by the system window list: Chrome leaves a closed window listed
  /// for seconds (finding H), and a Terminal window blocked by a dialog
  /// is still listed (D1). Without a held reference (e.g. after an app
  /// restart) a window that's in the system list but not reachable
  /// through Accessibility — usually because it's on another desktop —
  /// is reported alive but unreachable; `focusWindow` re-acquires it.
  func windowState(pid: pid_t, windowId: CGWindowID) throws -> JSONObject {
    if let element = try element(pid: pid, windowId: windowId) {
      return ["state": try hasSheet(element) ? "blocked" : "alive", "reachable": true]
    }
    if existsUnreachable(pid: pid, windowId: windowId) {
      return ["state": "alive", "reachable": false]
    }
    return ["state": "gone", "reachable": false]
  }

  /// The titles of the tabs in the window's own tab strip, in order —
  /// cheap to read, and how a change to a browser window's tabs is
  /// noticed (its URLs need the browser's scripting interface). A
  /// window with no tab strip reports `hasTabStrip: false`.
  func windowTabs(pid: pid_t, windowId: CGWindowID) throws -> JSONObject {
    guard let window = try element(pid: pid, windowId: windowId) else {
      throw RpcError(code: "gone", message: "Window \(windowId) is gone")
    }
    guard let strip = try tabStrip(window) else { return ["hasTabStrip": false, "titles": []] }
    let tabs = try tabs(in: strip, depth: 3)
    var result: JSONObject = [
      "hasTabStrip": true,
      "titles": tabs.map { tab in (try? attribute(tab, kAXTitleAttribute)) ?? "" },
    ]
    // 1-based, like the browser's own; the selected tab's radio button has value 1.
    if let selected = tabs.firstIndex(where: { tab in
      let value: NSNumber? = try? attribute(tab, kAXValueAttribute)
      return value?.intValue == 1
    }) {
      result["selectedIndex"] = selected + 1
    }
    // The page on screen — the only tab whose URL Accessibility exposes.
    if let page = try webArea(window), let url: URL = try? attribute(page, "AXURL") {
      result["activeUrl"] = url.absoluteString
    }
    return result
  }

  /// The window's page (its first `AXWebArea`), breadth first.
  private func webArea(_ window: AXUIElement) throws -> AXUIElement? {
    var level: [AXUIElement] = [window]
    for _ in 0..<12 {
      var next: [AXUIElement] = []
      for element in level {
        let children: [AXUIElement] = try attribute(element, kAXChildrenAttribute) ?? []
        for child in children {
          let role: String? = try? attribute(child, kAXRoleAttribute)
          if role == "AXWebArea" { return child }
          next.append(child)
        }
      }
      if next.isEmpty { return nil }
      level = next
    }
    return nil
  }

  /// Tabs inside a tab strip, in order — grouped tabs sit one level
  /// down, inside their group.
  private func tabs(in element: AXUIElement, depth: Int) throws -> [AXUIElement] {
    let children: [AXUIElement] = try attribute(element, kAXChildrenAttribute) ?? []
    return try children.flatMap { child -> [AXUIElement] in
      let role: String? = try? attribute(child, kAXRoleAttribute)
      if role == kAXRadioButtonRole { return [child] }
      return depth > 1 ? try tabs(in: child, depth: depth - 1) : []
    }
  }

  /// The window's first tab group outside any page, breadth first.
  private func tabStrip(_ window: AXUIElement) throws -> AXUIElement? {
    // Chrome's sits 7 levels down (window > 6 groups > tab group).
    var level: [AXUIElement] = [window]
    for _ in 0..<10 {
      var next: [AXUIElement] = []
      for element in level {
        let children: [AXUIElement] = try attribute(element, kAXChildrenAttribute) ?? []
        for child in children {
          let role: String? = try? attribute(child, kAXRoleAttribute)
          if role == kAXTabGroupRole { return child }
          if role != "AXWebArea" { next.append(child) }
        }
      }
      if next.isEmpty { return nil }
      level = next
    }
    return nil
  }

  /// Presses the window's own close button — never a forced close.
  /// A window showing a sheet (e.g. Terminal's "terminate running
  /// processes?") is left alone and reported `blocked`; the helper
  /// never confirms a dialog on the user's behalf.
  func closeWindow(pid: pid_t, windowId: CGWindowID, wait: TimeInterval) throws -> JSONObject {
    guard let element = try element(pid: pid, windowId: windowId) else {
      if existsUnreachable(pid: pid, windowId: windowId) {
        throw RpcError(
          code: "unreachable",
          message: "Window \(windowId) exists but isn't reachable through Accessibility")
      }
      return ["outcome": "already-gone"]
    }
    if try hasSheet(element) { return ["outcome": "blocked"] }

    guard let button: AXUIElement = try attribute(element, kAXCloseButtonAttribute) else {
      throw RpcError(code: "no-close-button", message: "Window \(windowId) has no close button")
    }
    try check(AXUIElementPerformAction(button, kAXPressAction as CFString), "press close")

    let deadline = Date().addingTimeInterval(wait)
    repeat {
      Thread.sleep(forTimeInterval: 0.1)
      guard try isValid(element) else {
        held[windowId] = nil
        gone.insert(windowId)
        return ["outcome": "closed"]
      }
      if try hasSheet(element) { return ["outcome": "blocked"] }
    } while Date() < deadline
    return ["outcome": "still-open"]
  }

  /// Un-minimize, raise, then activate the owning app. Since macOS 14
  /// activation is a request the system may refuse, so it's verified
  /// against the actually-focused app, falling back to Launch Services
  /// (`open -b`, what a Dock click does) only when refused. A window on
  /// another desktop with no held reference only becomes reachable
  /// once its app is active (finding S2), so that case activates first
  /// — which visibly jumps to that desktop (decision 6).
  func focusWindow(pid: pid_t, windowId: CGWindowID) throws -> JSONObject {
    guard let app = NSRunningApplication(processIdentifier: pid), processAlive(pid) else {
      throw RpcError(code: "gone", message: "Process \(pid) is no longer running")
    }

    var target = try element(pid: pid, windowId: windowId)
    if target == nil {
      guard existsUnreachable(pid: pid, windowId: windowId) else {
        throw RpcError(code: "gone", message: "Window \(windowId) no longer exists")
      }
      _ = activate(app)
      let deadline = Date().addingTimeInterval(1)
      while target == nil && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.1)
        target = try element(pid: pid, windowId: windowId)
      }
    }
    guard let window = target else {
      throw RpcError(
        code: "unreachable",
        message: "Window \(windowId) exists but didn't become reachable after activating its app")
    }

    if try attribute(window, kAXMinimizedAttribute) == true {
      try check(
        AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse),
        "un-minimize")
    }
    // Some windows don't support raising (Calculator's, on macOS 26):
    // activating the app below still brings its main window up — so only
    // a real failure (no permission, an app not answering) is an error.
    let raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    if raised != .actionUnsupported && raised != .attributeUnsupported {
      try check(raised, "raise")
    }
    // Best effort: makes it the window the app itself treats as main,
    // so activation doesn't bring a different one of its windows up.
    _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)

    if activate(app) { return ["activated": true, "via": "activate"] }
    if let bundleId = app.bundleIdentifier, openWithLaunchServices(bundleId),
      waitUntilFrontmost(pid)
    {
      return ["activated": true, "via": "launch-services"]
    }
    return ["activated": false]
  }

  /// A held reference first (pruned once it stops resolving), then a
  /// fresh lookup among the process's current Accessibility windows —
  /// which is held from then on.
  private func element(pid: pid_t, windowId: CGWindowID) throws -> AXUIElement? {
    pruneDeadOwners()
    guard !gone.contains(windowId) else { return nil }
    if let entry = held[windowId], entry.pid == pid {
      if try isValid(entry.element) { return entry.element }
      held[windowId] = nil
      gone.insert(windowId)
      return nil
    }
    guard processAlive(pid) else { return nil }
    guard let found = try axWindows(pid).first(where: { windowIdOf($0) == windowId }) else {
      return nil
    }
    hold(windowId, pid: pid, found)
    return found
  }

  private func hold(_ windowId: CGWindowID, pid: pid_t, _ element: AXUIElement) {
    held[windowId] = HeldWindow(pid: pid, startedAt: processStartTime(pid), element: element)
  }

  /// A window whose process has exited (or whose pid now belongs to a
  /// different process) is gone. Checked before its held reference is
  /// used: a reference into a dead process doesn't report itself
  /// invalid — every message to it just times out, which would read as
  /// "not answering" forever instead of "gone".
  private func pruneDeadOwners() {
    for (windowId, entry) in held
    where !processAlive(entry.pid) || processStartTime(entry.pid) != entry.startedAt {
      held[windowId] = nil
      gone.insert(windowId)
    }
  }

  /// In the system window list but not reachable through
  /// Accessibility — usually a window on another desktop that this
  /// helper never held a reference to.
  private func existsUnreachable(pid: pid_t, windowId: CGWindowID) -> Bool {
    !gone.contains(windowId) && processAlive(pid) && systemListContains(windowId, pid: pid)
  }

  private func info(_ element: AXUIElement, pid: pid_t) -> WindowInfo? {
    guard let id = windowIdOf(element) else { return nil }
    let subrole: String? = try? attribute(element, kAXSubroleAttribute)
    return WindowInfo(
      id: id,
      pid: pid,
      title: (try? attribute(element, kAXTitleAttribute)) ?? "",
      minimized: (try? attribute(element, kAXMinimizedAttribute)) ?? false,
      standard: subrole == (kAXStandardWindowSubrole as String),
      frame: frameOf(element))
  }

  private func frameOf(_ element: AXUIElement) -> CGRect? {
    guard let position: AXValue = try? attribute(element, kAXPositionAttribute),
      let size: AXValue = try? attribute(element, kAXSizeAttribute)
    else { return nil }
    var origin = CGPoint.zero
    var extent = CGSize.zero
    guard AXValueGetValue(position, .cgPoint, &origin), AXValueGetValue(size, .cgSize, &extent)
    else { return nil }
    return CGRect(origin: origin, size: extent)
  }

  private func hasSheet(_ window: AXUIElement) throws -> Bool {
    let children: [AXUIElement] = try attribute(window, kAXChildrenAttribute) ?? []
    return children.contains { (try? attribute($0, kAXRoleAttribute)) == "AXSheet" }
  }

  private func isValid(_ element: AXUIElement) throws -> Bool {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value)
    if result == .invalidUIElement { return false }
    try check(result, "read window role")
    return true
  }
}

func runningApps(_ bundleId: String) -> [NSRunningApplication] {
  // The list is kept fresh by the run loop spinning between requests;
  // the kernel check drops an entry for a process that exited since.
  NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
    .filter { processAlive($0.processIdentifier) }
}

/// When the process started, in milliseconds since the epoch — with
/// the pid, what identifies one process instance across pid reuse.
func processStartTime(_ pid: pid_t) -> Int64? {
  var info = proc_bsdinfo()
  let size = Int32(MemoryLayout<proc_bsdinfo>.size)
  guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
  return Int64(info.pbi_start_tvsec) * 1000 + Int64(info.pbi_start_tvusec) / 1000
}

/// The kernel's answer, not NSRunningApplication.isTerminated — that
/// only refreshes via the run loop, which doesn't spin mid-request.
func processAlive(_ pid: pid_t) -> Bool {
  kill(pid, 0) == 0
}

/// Activates the app and reports whether it actually became frontmost.
func activate(_ app: NSRunningApplication) -> Bool {
  if #available(macOS 14, *) {
    app.activate()
  } else {
    app.activate(options: [.activateIgnoringOtherApps])
  }
  return waitUntilFrontmost(app.processIdentifier)
}

func waitUntilFrontmost(_ pid: pid_t) -> Bool {
  let deadline = Date().addingTimeInterval(0.5)
  repeat {
    if focusedApplicationPid() == pid { return true }
    Thread.sleep(forTimeInterval: 0.05)
  } while Date() < deadline
  return false
}

/// Read through Accessibility rather than NSWorkspace's
/// frontmostApplication, which only updates via the run loop.
private func focusedApplicationPid() -> pid_t? {
  guard let app: AXUIElement = try? attribute(
    AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute)
  else { return nil }
  var pid: pid_t = 0
  return AXUIElementGetPid(app, &pid) == .success ? pid : nil
}

func openWithLaunchServices(_ bundleId: String) -> Bool {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  // argv, never a shell string — and the id comes from the system's
  // own record of the running app, not from the request.
  process.arguments = ["-b", bundleId]
  do { try process.run() } catch { return false }
  process.waitUntilExit()
  return process.terminationStatus == 0
}

private func axWindows(_ pid: pid_t) throws -> [AXUIElement] {
  do {
    return try attribute(AXUIElementCreateApplication(pid), kAXWindowsAttribute) ?? []
  } catch let error as RpcError where error.code == "ax-error" {
    // An app that's quitting, or has no Accessibility support at all,
    // has no reachable windows — not a failure of this request.
    return []
  }
}

private func windowIdOf(_ element: AXUIElement) -> CGWindowID? {
  var id: CGWindowID = 0
  return axGetWindow(element, &id) == .success && id != 0 ? id : nil
}

/// Whether the system-wide window list has this window for this
/// process. Window titles there need Screen Recording; ids and owners
/// don't (finding G), so this never needs that permission.
private func systemListContains(_ windowId: CGWindowID, pid: pid_t) -> Bool {
  let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowId) as? [JSONObject] ?? []
  return list.contains {
    ($0[kCGWindowNumber as String] as? Int) == Int(windowId)
      && ($0[kCGWindowOwnerPID as String] as? pid_t) == pid
  }
}

/// Reads an attribute. A missing value is nil; a permission failure, a
/// hung app (the 1s messaging timeout) or a dead element throws, so a
/// caller can never mistake "couldn't ask" for "no".
func attribute<T>(_ element: AXUIElement, _ name: String) throws -> T? {
  var value: CFTypeRef?
  let result = AXUIElementCopyAttributeValue(element, name as CFString, &value)
  switch result {
  case .success: return value as? T
  case .noValue, .attributeUnsupported: return nil
  default:
    try check(result, "read \(name)")
    return nil
  }
}

func check(_ result: AXError, _ action: String) throws {
  switch result {
  case .success:
    return
  case .apiDisabled:
    throw RpcError(
      code: "not-trusted", message: "Accessibility permission is not granted (\(action))")
  case .cannotComplete:
    throw RpcError(
      code: "ax-timeout", message: "The app didn't respond to Accessibility in time (\(action))")
  default:
    throw RpcError(code: "ax-error", message: "Accessibility error \(result.rawValue) (\(action))")
  }
}
