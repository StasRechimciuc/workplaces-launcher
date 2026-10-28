import AppKit

/// App-level operations: no per-window identity, just whether an app
/// is running and asking it to quit.
enum Apps {
  /// Each instance comes with its process start time: a pid alone can
  /// be reused by an unrelated process, so the client matches on both.
  /// From the kernel rather than NSRunningApplication.launchDate, which
  /// is nil for apps macOS didn't start through Launch Services (Finder,
  /// anything started at login).
  static func isRunning(bundleId: String) -> JSONObject {
    let apps = runningApps(bundleId)
    return [
      "running": !apps.isEmpty,
      "pids": apps.map(\.processIdentifier),
      "apps": apps.map { app -> JSONObject in
        let pid = app.processIdentifier
        return ["pid": pid, "startedAt": processStartTime(pid).map { $0 as Any } ?? NSNull()]
      },
    ]
  }

  /// The app's own native quit (`NSRunningApplication.terminate`) —
  /// the same as choosing Quit from its menu, so it can still show its
  /// own "save changes?" prompt and stay running. Triggers no
  /// Automation prompt (finding A), unlike AppleScript `quit`.
  static func quit(pid: pid_t, wait: TimeInterval) throws -> JSONObject {
    // Never this helper or the app that spawned it.
    guard pid != getpid(), pid != getppid() else {
      throw RpcError.invalidParams("Refusing to quit Workspace Launcher itself")
    }
    guard processAlive(pid), let app = NSRunningApplication(processIdentifier: pid) else {
      return ["outcome": "not-running"]
    }
    guard app.terminate() else {
      throw RpcError(code: "quit-refused", message: "macOS didn't deliver the quit request to \(pid)")
    }
    let deadline = Date().addingTimeInterval(wait)
    while processAlive(pid) && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.1)
    }
    return ["outcome": processAlive(pid) ? "still-running" : "quit"]
  }
}
