import AppKit
import ApplicationServices

/// The persistent `serve` mode: one JSON request per stdin line, one
/// JSON response per stdout line, matched by `id`.
///
/// Requests run one at a time on the main thread, whose run loop spins
/// between them — that's what keeps NSRunningApplication's view of
/// running apps current. stdin is read on a background thread; its EOF
/// (the parent app quit, crashed, or closed the pipe) ends the process
/// once every request already read has been answered, so the helper
/// can never outlive the app as an orphan.
final class Server {
  private let windows = WindowRegistry()

  func run() -> Never {
    // Global default for every element: an app that stops answering
    // Accessibility (beachballing) costs at most a second per call
    // instead of the system's default of several, so one hung app
    // can't stall the whole queue past the client's own timeouts.
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1.0)
    // A write to a closed stdout must fail with EPIPE, not kill the
    // process before it can exit on its own terms.
    signal(SIGPIPE, SIG_IGN)

    write(["event": "ready", "protocolVersion": protocolVersion, "pid": getpid()])

    let reader = Thread {
      while let line = readLine(strippingNewline: true) {
        DispatchQueue.main.async { self.handle(line) }
      }
      DispatchQueue.main.async { exit(0) }
    }
    reader.start()
    RunLoop.main.run()
    exit(0)
  }

  private func handle(_ line: String) {
    guard line.utf8.count <= 1_048_576,
      let data = line.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? JSONObject,
      let idNumber = request["id"] as? NSNumber, CFGetTypeID(idNumber) != CFBooleanGetTypeID(),
      let method = request["method"] as? String
    else {
      // No usable id to answer against — reported as a protocol event
      // the client logs loudly, rather than dropped.
      write(["event": "protocol-error", "message": "Malformed request line (\(line.utf8.count) bytes)"])
      return
    }
    let id = idNumber.int64Value
    guard let params = (request["params"] ?? JSONObject()) as? JSONObject else {
      respond(id, .failure(RpcError.invalidParams("params must be an object")))
      return
    }

    do {
      respond(id, .success(try dispatch(method, Params(raw: params))))
    } catch let error as RpcError {
      respond(id, .failure(error))
    } catch {
      respond(id, .failure(RpcError(code: "internal", message: "\(error)")))
    }
  }

  private func dispatch(_ method: String, _ params: Params) throws -> Any {
    switch method {
    case "listWindows":
      return try windows.listWindows(bundleId: params.bundleId("bundleId")).map(\.json)
    case "captureNewWindow":
      return try windows.captureNewWindow(
        bundleId: params.bundleId("bundleId"),
        before: params.windowIds("before"),
        titleContains: params.optionalString("titleContains"),
        timeout: params.milliseconds("timeoutMs", default: 10_000)
      ).json
    case "windowState":
      return try windows.windowState(pid: params.pid("pid"), windowId: params.windowId("windowId"))
    case "closeWindow":
      return try windows.closeWindow(
        pid: params.pid("pid"),
        windowId: params.windowId("windowId"),
        wait: params.milliseconds("waitMs", default: 1_500))
    case "focusWindow":
      return try windows.focusWindow(pid: params.pid("pid"), windowId: params.windowId("windowId"))
    case "isRunning":
      return Apps.isRunning(bundleId: try params.bundleId("bundleId"))
    case "activateApp":
      return try Apps.bringForward(pid: params.pid("pid"))
    case "processStartTime":
      // Any process, not only apps: a terminal's shell is identified by
      // pid + start time, since pids are reused.
      let pid = try params.pid("pid")
      return ["startedAt": processStartTime(pid).map { $0 as Any } ?? NSNull()]
    case "quitApp":
      return try Apps.quit(pid: params.pid("pid"), wait: params.milliseconds("waitMs", default: 5_000))
    default:
      throw RpcError(code: "unknown-method", message: "Unknown method \(method)")
    }
  }

  private func respond(_ id: Int64, _ outcome: Result<Any, RpcError>) {
    switch outcome {
    case .success(let result):
      write(["id": id, "ok": true, "result": result])
    case .failure(let error):
      write(["id": id, "ok": false, "error": ["code": error.code, "message": error.message]])
    }
  }
}

/// Writes one JSON object as one line. A failed write means the parent
/// is gone — there's no one left to answer, so exit.
func write(_ object: JSONObject) {
  guard var data = try? JSONSerialization.data(withJSONObject: object) else {
    FileHandle.standardError.write(Data("wl-helper: unserializable response\n".utf8))
    exit(70)
  }
  data.append(0x0A)
  let written = data.withUnsafeBytes { buffer -> Bool in
    var offset = 0
    while offset < buffer.count {
      let count = Darwin.write(STDOUT_FILENO, buffer.baseAddress! + offset, buffer.count - offset)
      if count < 0 {
        if errno == EINTR { continue }
        return false
      }
      offset += count
    }
    return true
  }
  if !written { exit(0) }
}
