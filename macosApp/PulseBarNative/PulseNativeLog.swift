import Foundation

/// Swift-side companion to `io.github.kt.pulsebar.core.log.PulseLogger`.
///
/// Until the native layer is fully collapsed into Kotlin (Phase 3), a few
/// Swift-owned subsystems (CoreAudio capture, WebRTC publisher, AppKit
/// status-item lifecycle) still need local log points. This shim ensures they
/// land in the same file (`~/Library/Logs/PulseBarNative/pulsebar.log`) and
/// use the same structured line shape as the Kotlin facade so `tail -f`
/// produces a single time-ordered view.
enum PulseNativeLog {
    enum Category: String {
        case platformAdapter = "platform.adapter"
        case liveListenSession = "live_listen.session"
    }

    enum Level: String {
        case debug
        case info
        case warn
        case error
    }

    static func log(
        _ level: Level,
        _ category: Category,
        _ event: String,
        fields: [String: Any?] = [:]
    ) {
        let line = formatLine(level: level, category: category, event: event, fields: fields)
        emit(level: level, line: line)
    }

    static func debug(_ category: Category, _ event: String, fields: [String: Any?] = [:]) {
        log(.debug, category, event, fields: fields)
    }

    static func info(_ category: Category, _ event: String, fields: [String: Any?] = [:]) {
        log(.info, category, event, fields: fields)
    }

    static func warn(_ category: Category, _ event: String, fields: [String: Any?] = [:]) {
        log(.warn, category, event, fields: fields)
    }

    static func error(_ category: Category, _ event: String, fields: [String: Any?] = [:]) {
        log(.error, category, event, fields: fields)
    }

    // MARK: - Formatting

    private nonisolated(unsafe) static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static func formatLine(
        level: Level,
        category: Category,
        event: String,
        fields: [String: Any?]
    ) -> String {
        var parts: [String] = []
        parts.append(isoFormatter.string(from: Date()))
        parts.append("[\(level.rawValue)]")
        parts.append(category.rawValue)
        parts.append("event=\(event)")
        for (key, value) in fields {
            guard let value else { continue }
            parts.append("\(key)=\(render(value))")
        }
        return parts.joined(separator: " ")
    }

    private static func render(_ value: Any) -> String {
        let raw = String(describing: value)
        if raw.contains(where: { $0.isWhitespace || $0 == "\"" }) {
            return "\"" + raw.replacingOccurrences(of: "\"", with: "\\\"") + "\""
        }
        return raw
    }

    // MARK: - Sink

    private static let fileQueue = DispatchQueue(label: "io.github.kt.pulsebar.native.log.file", qos: .utility)

    private static let logFileURL: URL? = {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser
        let directory = home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Logs", isDirectory: true)
            .appendingPathComponent("PulseBarNative", isDirectory: true)
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        return directory.appendingPathComponent("pulsebar.log", isDirectory: false)
    }()

    private static func emit(level: Level, line: String) {
        #if DEBUG
        print(line)
        #else
        if level == .warn || level == .error {
            FileHandle.standardError.write(Data((line + "\n").utf8))
        }
        #endif
        guard let logFileURL else { return }
        let data = Data((line + "\n").utf8)
        fileQueue.async {
            let fileManager = FileManager.default
            if !fileManager.fileExists(atPath: logFileURL.path) {
                try? data.write(to: logFileURL)
                return
            }
            if let handle = try? FileHandle(forWritingTo: logFileURL) {
                _ = try? handle.seekToEnd()
                _ = try? handle.write(contentsOf: data)
                try? handle.close()
            }
        }
    }
}
