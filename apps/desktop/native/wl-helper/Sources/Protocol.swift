import CoreGraphics
import Foundation

/// Version of the JSON-lines protocol spoken over stdin/stdout. Sent in
/// the `ready` event so the TypeScript client (wl-helper-client.ts) can
/// refuse a helper binary from a different build instead of
/// misreading its replies. Bump on any incompatible change to a
/// method's params or result shape.
let protocolVersion = 1

typealias JSONObject = [String: Any]

/// A failure reported to the client as `{"id":…,"ok":false,"error":{…}}`.
/// `code` is a short, stable machine-readable slug the client branches
/// on; `message` is the human-readable detail it logs and surfaces.
struct RpcError: Error {
  let code: String
  let message: String

  static func invalidParams(_ message: String) -> RpcError {
    RpcError(code: "invalid-params", message: message)
  }
}

/// Typed, validated access to a request's `params` object. Every
/// value arriving here came from another process, so nothing is
/// trusted: wrong types, out-of-range numbers and malformed bundle ids
/// are rejected with `invalid-params` before any system call sees them.
struct Params {
  let raw: JSONObject

  func pid(_ key: String) throws -> pid_t {
    guard let value = raw[key] as? NSNumber, isIntegral(value),
      value.int64Value > 0, value.int64Value <= Int64(Int32.max)
    else { throw RpcError.invalidParams("\(key) must be a positive process id") }
    return pid_t(value.int64Value)
  }

  func windowId(_ key: String) throws -> CGWindowID {
    guard let value = raw[key] as? NSNumber else {
      throw RpcError.invalidParams("\(key) must be a window id")
    }
    return try Params.windowId(value, key)
  }

  func windowIds(_ key: String) throws -> Set<CGWindowID> {
    guard let values = raw[key] as? [Any], values.count <= 10_000 else {
      throw RpcError.invalidParams("\(key) must be an array of at most 10000 window ids")
    }
    return Set(
      try values.map { value in
        guard let number = value as? NSNumber else {
          throw RpcError.invalidParams("\(key) must contain only window ids")
        }
        return try Params.windowId(number, key)
      })
  }

  func bundleId(_ key: String) throws -> String {
    guard let value = raw[key] as? String, !value.isEmpty, value.count <= 255,
      value.unicodeScalars.allSatisfy(Params.bundleIdCharacters.contains)
    else { throw RpcError.invalidParams("\(key) must be a bundle identifier") }
    return value
  }

  /// Milliseconds, defaulting when absent; capped at a minute so a
  /// malformed request can't park the helper's only request queue.
  func milliseconds(_ key: String, default defaultValue: Int) throws -> TimeInterval {
    guard let value = raw[key] else { return TimeInterval(defaultValue) / 1000 }
    guard let number = value as? NSNumber, isIntegral(number),
      number.int64Value >= 0, number.int64Value <= 60_000
    else { throw RpcError.invalidParams("\(key) must be an integer between 0 and 60000") }
    return TimeInterval(number.int64Value) / 1000
  }

  // Reverse-DNS bundle identifiers: letters, digits, '.', '-' and '_'.
  private static let bundleIdCharacters = CharacterSet(
    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_")

  private static func windowId(_ value: NSNumber, _ key: String) throws -> CGWindowID {
    guard isIntegral(value), value.int64Value > 0, value.int64Value <= Int64(UInt32.max) else {
      throw RpcError.invalidParams("\(key) must be a positive window id")
    }
    return CGWindowID(value.int64Value)
  }
}

/// JSON booleans also bridge to NSNumber — rejecting them and any
/// fractional value keeps `true` or `1.5` from passing as an id.
private func isIntegral(_ value: NSNumber) -> Bool {
  CFGetTypeID(value) != CFBooleanGetTypeID() && value.doubleValue == value.doubleValue.rounded()
}
