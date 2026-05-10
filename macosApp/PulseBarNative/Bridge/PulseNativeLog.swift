import Foundation
import os

/// Swift-side companion to the Kotlin kermit logger. Uses Apple's structured
/// logging (`os.Logger`) so entries appear in Console.app under subsystem
/// `io.github.kt.pulsebar` with the same categories as the Kotlin tags:
/// `app.lifecycle`, `config.store`, `stats.refresh`, `sync.endpoint`,
/// `live_listen.session`, `platform.adapter`.
///
/// This is only for Swift-owned subsystems that Kotlin cannot reach yet
/// (CoreAudio capture, WebRTC publisher, AppKit status-item lifecycle). Once
/// Phase 3 moves orchestration into Kotlin, most of these call sites will
/// migrate to kermit directly.
enum PulseNativeLog {
    enum Category: String {
        case appLifecycle = "app.lifecycle"
        case platformAdapter = "platform.adapter"
        case liveListenSession = "live_listen.session"
    }

    private static let subsystem = "io.github.kt.pulsebar"

    private static let loggers: [Category: Logger] = [
        .appLifecycle: Logger(subsystem: subsystem, category: Category.appLifecycle.rawValue),
        .platformAdapter: Logger(subsystem: subsystem, category: Category.platformAdapter.rawValue),
        .liveListenSession: Logger(subsystem: subsystem, category: Category.liveListenSession.rawValue),
    ]

    static func debug(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        loggers[category]?.debug("\(message(), privacy: .public)")
    }

    static func info(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        loggers[category]?.info("\(message(), privacy: .public)")
    }

    static func warn(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        loggers[category]?.warning("\(message(), privacy: .public)")
    }

    static func error(_ category: Category, _ message: @autoclosure @escaping () -> String) {
        loggers[category]?.error("\(message(), privacy: .public)")
    }
}
