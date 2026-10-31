import AppKit
import ApplicationServices

/// Pushes change events for the apps the client asked to watch — the
/// signal a browser window's tabs may have changed (WCs/
/// WC__window-tracking.md, Phase 4), so they're saved when they change
/// instead of being polled. Measured on Chrome: watching costs nothing
/// noticeable while the browser is idle.
///
/// Events (unsolicited lines, no `id`):
/// - `app-changed` {bundleId, pid}: a window was created, destroyed or
///   retitled, or a tab in a tab strip was retitled (opened, closed,
///   switched, navigated). Page content is filtered out by role — a
///   video's ticking timer must never reach the client. At most one per
///   app every `throttle`, with a trailing one so the last change is
///   never dropped.
/// - `app-launched` / `app-terminated` {bundleId, pid}: an instance of a
///   watched app started or exited — watching follows it across
///   restarts, so the client subscribes once per app.
final class AppWatcher {
  private struct Watched {
    let bundleId: String
    let observer: AXObserver
  }

  private let throttle: TimeInterval = 0.5
  private var bundleIds: Set<String> = []
  private var observed: [pid_t: Watched] = [:]
  private var lastEmitted: [pid_t: Date] = [:]
  private var trailing: Set<pid_t> = []

  init() {
    let center = NSWorkspace.shared.notificationCenter
    center.addObserver(
      forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      guard let self, let app = Self.app(note), let bundleId = app.bundleIdentifier,
        self.bundleIds.contains(bundleId)
      else { return }
      write(["event": "app-launched", "bundleId": bundleId, "pid": app.processIdentifier])
      self.attach(app, attemptsLeft: 10)
    }
    center.addObserver(
      forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      guard let self, let app = Self.app(note), let watched = self.observed[app.processIdentifier]
      else { return }
      self.detach(app.processIdentifier)
      write(["event": "app-terminated", "bundleId": watched.bundleId, "pid": app.processIdentifier])
    }
  }

  /// Instances that can't be observed right now (beachballing, still
  /// launching) are retried in the background rather than failing the
  /// watch — it stays in force either way.
  func watch(bundleId: String) -> JSONObject {
    bundleIds.insert(bundleId)
    for app in runningApps(bundleId) { attach(app, attemptsLeft: 10) }
    return ["watching": true, "pids": runningApps(bundleId).map(\.processIdentifier)]
  }

  func unwatch(bundleId: String) -> JSONObject {
    bundleIds.remove(bundleId)
    for (pid, watched) in observed where watched.bundleId == bundleId { detach(pid) }
    return ["watching": false]
  }

  private static func app(_ note: Notification) -> NSRunningApplication? {
    note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
  }

  /// From a launch notification: an app that's still starting up can't
  /// be observed yet, so a failure is retried every second for a while,
  /// then logged — never thrown, there's no request to answer.
  private func attach(_ app: NSRunningApplication, attemptsLeft: Int) {
    guard !app.isTerminated, observed[app.processIdentifier] == nil,
      let bundleId = app.bundleIdentifier, bundleIds.contains(bundleId)
    else { return }
    do {
      try attachOrThrow(app)
    } catch {
      guard attemptsLeft > 1 else {
        FileHandle.standardError.write(
          Data("wl-helper: couldn't watch pid \(app.processIdentifier): \(error)\n".utf8))
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
        self?.attach(app, attemptsLeft: attemptsLeft - 1)
      }
    }
  }

  private func attachOrThrow(_ app: NSRunningApplication) throws {
    guard let bundleId = app.bundleIdentifier else { return }
    let pid = app.processIdentifier
    var created: AXObserver?
    try check(AXObserverCreate(pid, watcherCallback, &created), "watch pid \(pid)")
    guard let observer = created else { return }
    let element = AXUIElementCreateApplication(pid)
    let refcon = Unmanaged.passUnretained(self).toOpaque()
    for notification in [
      kAXWindowCreatedNotification, kAXUIElementDestroyedNotification, kAXTitleChangedNotification,
    ] {
      let result = AXObserverAddNotification(observer, element, notification as CFString, refcon)
      if result != .success && result != .notificationAlreadyRegistered {
        try check(result, "watch \(notification) of pid \(pid)")
      }
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
    observed[pid] = Watched(bundleId: bundleId, observer: observer)
  }

  private func detach(_ pid: pid_t) {
    guard let watched = observed.removeValue(forKey: pid) else { return }
    CFRunLoopRemoveSource(
      CFRunLoopGetMain(), AXObserverGetRunLoopSource(watched.observer), .defaultMode)
    lastEmitted[pid] = nil
    trailing.remove(pid)
  }

  fileprivate func handle(_ observer: AXObserver, _ element: AXUIElement, _ notification: String) {
    guard let (pid, watched) = observed.first(where: { CFEqual($0.value.observer, observer) })
    else { return }
    if notification == kAXTitleChangedNotification && !isWindowOrTab(element) { return }
    emit(pid, watched.bundleId)
  }

  /// A window's own title, or a tab in its tab strip — anything inside
  /// a page (`AXWebArea`) is page content.
  private func isWindowOrTab(_ element: AXUIElement) -> Bool {
    let role: String? = try? attribute(element, kAXRoleAttribute)
    if role == kAXWindowRole { return true }
    guard role == kAXRadioButtonRole else { return false }
    var current = element
    for _ in 0..<4 {
      guard let parent: AXUIElement = try? attribute(current, kAXParentAttribute) else {
        return false
      }
      let parentRole: String? = try? attribute(parent, kAXRoleAttribute)
      if parentRole == kAXTabGroupRole { return true }
      if parentRole == "AXWebArea" || parentRole == kAXWindowRole { return false }
      current = parent
    }
    return false
  }

  private func emit(_ pid: pid_t, _ bundleId: String) {
    let now = Date()
    if let last = lastEmitted[pid], now.timeIntervalSince(last) < throttle {
      guard !trailing.contains(pid) else { return }
      trailing.insert(pid)
      DispatchQueue.main.asyncAfter(deadline: .now() + throttle - now.timeIntervalSince(last)) {
        [weak self] in
        guard let self, self.trailing.remove(pid) != nil, self.observed[pid] != nil else { return }
        self.lastEmitted[pid] = Date()
        write(["event": "app-changed", "bundleId": bundleId, "pid": pid])
      }
      return
    }
    lastEmitted[pid] = now
    write(["event": "app-changed", "bundleId": bundleId, "pid": pid])
  }
}

private let watcherCallback: AXObserverCallback = { observer, element, notification, refcon in
  guard let refcon else { return }
  Unmanaged<AppWatcher>.fromOpaque(refcon).takeUnretainedValue()
    .handle(observer, element, notification as String)
}
