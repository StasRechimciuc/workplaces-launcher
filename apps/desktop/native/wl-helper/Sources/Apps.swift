import AppKit

/// App-level operations: no per-window identity, just whether an app
/// is running and asking it to quit.
enum Apps {
  static func isRunning(bundleId: String) -> JSONObject {
    let pids = runningApps(bundleId).map(\.processIdentifier)
    return ["running": !pids.isEmpty, "pids": pids]
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
