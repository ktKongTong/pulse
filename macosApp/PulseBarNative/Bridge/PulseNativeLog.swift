@preconcurrency import PulseBarShared

typealias PulseNativeLog = ExportedKotlinPackages.io.github.kt.pulsebar.logger.PulseNativeLog
typealias PulseNativeLogCategory = ExportedKotlinPackages.io.github.kt.pulsebar.logger.PulseNativeLogCategory

extension PulseNativeLog {
    static func debug(_ category: PulseNativeLogCategory, _ message: @autoclosure () -> String) {
        shared.debug(
            category: category,
            message: message()
        )
    }

    static func info(_ category: PulseNativeLogCategory, _ message: @autoclosure () -> String) {
        shared.info(
            category: category,
            message: message()
        )
    }

    static func warn(_ category: PulseNativeLogCategory, _ message: @autoclosure () -> String) {
        shared.warn(
            category: category,
            message: message()
        )
    }
}
