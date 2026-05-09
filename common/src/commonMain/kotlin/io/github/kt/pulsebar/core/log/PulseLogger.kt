package io.github.kt.pulsebar.core.log

/**
 * Category labels that correspond to the plan's §6.2 logging sections. They
 * become `os_log` categories on macOS and stdout prefixes on JVM.
 */
enum class PulseLogCategory(val tag: String) {
    AppLifecycle("app.lifecycle"),
    ConfigStore("config.store"),
    StatsRefresh("stats.refresh"),
    SyncEndpoint("sync.endpoint"),
    LiveListenSession("live_listen.session"),
    PlatformAdapter("platform.adapter"),
}

enum class PulseLogLevel { Debug, Info, Warn, Error }

/**
 * Thin KMP logger built on `expect fun platformLog` so the Swift Export
 * pipeline doesn't have to traverse third-party library symbols. macOS routes
 * to `os_log`, JVM routes to stdout.
 *
 * History: Phase 1 adopted co.touchlab.kermit, which works at runtime but
 * blocks Swift Export (kermit's `Logger.Companion.setLogWriters` has two
 * overloads that Swift can't disambiguate). Since the bridge now exports
 * `PulseBarBridge.observe*` closures, we had to replace kermit with this
 * small facade.
 */
class PulseBarLog(val category: PulseLogCategory) {
    fun d(message: () -> String) = platformLog(PulseLogLevel.Debug, category, message(), null)
    fun i(message: () -> String) = platformLog(PulseLogLevel.Info, category, message(), null)
    fun w(message: () -> String) = platformLog(PulseLogLevel.Warn, category, message(), null)
    fun w(error: Throwable?, message: () -> String) = platformLog(PulseLogLevel.Warn, category, message(), error)
    fun e(message: () -> String) = platformLog(PulseLogLevel.Error, category, message(), null)
    fun e(error: Throwable?, message: () -> String) = platformLog(PulseLogLevel.Error, category, message(), error)
}

fun logger(category: PulseLogCategory): PulseBarLog = PulseBarLog(category)

internal expect fun platformLog(
    level: PulseLogLevel,
    category: PulseLogCategory,
    message: String,
    error: Throwable?,
)
