import Foundation
import os

/// Swift-side companion to the Kotlin kermit logger. Uses Apple's structured
/// logging (`os.Logger`) so entries appear in Console.app under subsystem
/// `io.github.kt.pulsebar` with the same categories as the Kotlin tags:
/// `app.lifecycle`, `config.store`, `stats.refresh`, `sync.endpoint`,
/// `stream.session`, `platform.adapter`.
///
/// This is only for Swift-owned subsystems that Kotlin cannot reach yet
/// (CoreAudio capture, WebRTC publisher, AppKit status-item lifecycle). Once
/// Phase 3 moves orchestration into Kotlin, most of these call sites will
/// migrate to kermit directly.
enum PulseNativeLog {
    enum Category: String {
        case appLifecycle = "app.lifecycle"
        case platformAdapter = "platform.adapter"
        case streamSession = "stream.session"
    }

    private static let subsystem = "io.github.kt.pulsebar"
    private static let fileQueue = DispatchQueue(label: "io.github.kt.pulsebar.native-log-file")
    private static let logFileURL = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/PulseBarNative/pulse.log")

    private static let loggers: [Category: Logger] = [
        .appLifecycle: Logger(subsystem: subsystem, category: Category.appLifecycle.rawValue),
        .platformAdapter: Logger(subsystem: subsystem, category: Category.platformAdapter.rawValue),
        .streamSession: Logger(subsystem: subsystem, category: Category.streamSession.rawValue),
    ]

    static func debug(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        let text = message()
        loggers[category]?.debug("\(text, privacy: .public)")
        writeToFile(level: "D", category: category, message: text)
    }

    static func info(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        let text = message()
        loggers[category]?.info("\(text, privacy: .public)")
        writeToFile(level: "I", category: category, message: text)
    }

    static func warn(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        let text = message()
        loggers[category]?.warning("\(text, privacy: .public)")
        writeToFile(level: "W", category: category, message: text)
    }

    static func error(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        let text = message()
        loggers[category]?.error("\(text, privacy: .public)")
        writeToFile(level: "E", category: category, message: text)
    }

    private static func writeToFile(level: String, category: Category, message: String) {
        fileQueue.async {
            do {
                try FileManager.default.createDirectory(
                    at: logFileURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                let timestamp = Self.timestamp()
                let line = "\(timestamp) [\(level)][\(category.rawValue)] \(message)\n"
                guard let data = line.data(using: .utf8) else { return }
                if FileManager.default.fileExists(atPath: logFileURL.path) {
                    let handle = try FileHandle(forWritingTo: logFileURL)
                    try handle.seekToEnd()
                    try handle.write(contentsOf: data)
                    try handle.close()
                } else {
                    try data.write(to: logFileURL, options: .atomic)
                }
            } catch {
                loggers[category]?.error("native log file write failed \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter.string(from: Date())
    }
}
