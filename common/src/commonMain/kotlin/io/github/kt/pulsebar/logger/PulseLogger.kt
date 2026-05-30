package io.github.kt.pulsebar.logger

/**
 * Category labels that correspond to the plan's §6.2 logging sections. They
 * become `os_log` categories on macOS and stdout prefixes on JVM.
 */
enum class PulseLogCategory(val tag: String) {
    AppLifecycle("app.lifecycle"),
    ConfigStore("config.store"),
    StatsRefresh("stats.refresh"),
    SyncEndpoint("sync.endpoint"),
    StreamSession("stream.session"),
    PlatformAdapter("platform.adapter"),
    NativeEvent("native.event")
}

enum class PulseLogLevel { Debug, Info, Warn, Error }

/**
 * Mutable log configuration. Both sinks (NSLog/stderr and the file under
 * ~/Library/Logs/PulseBarNative/pulse.log on macOS, stdout on JVM) filter
 * independently so you can keep the file at `Info` while watching `Debug`
 * live from a terminal, or crank everything to `Debug` when diagnosing a
 * specific issue.
 *
 * Defaults can be overridden via environment variables read at process
 * start: `PULSE_LOG_LEVEL` (applies to both sinks), `PULSE_LOG_STDERR_LEVEL`,
 * `PULSE_LOG_FILE_LEVEL`. Values: `debug`, `info`, `warn`, `error`, `off`.
 */
object PulseLogConfig {
    var stderrLevel: PulseLogLevel = PulseLogLevel.Debug
    var fileLevel: PulseLogLevel = PulseLogLevel.Info

    fun parseLevel(raw: String?): PulseLogLevel? = when (raw?.lowercase()?.trim()) {
        "debug", "d" -> PulseLogLevel.Debug
        "info", "i" -> PulseLogLevel.Info
        "warn", "w", "warning" -> PulseLogLevel.Warn
        "error", "e", "err" -> PulseLogLevel.Error
        else -> null
    }

    fun shouldEmit(sinkLevel: PulseLogLevel, level: PulseLogLevel): Boolean =
        level.ordinal >= sinkLevel.ordinal
}

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
