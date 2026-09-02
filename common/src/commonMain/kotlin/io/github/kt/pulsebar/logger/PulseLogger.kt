package io.github.kt.pulsebar.logger

import co.touchlab.kermit.Logger

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
    NativeEvent("native.event");

    companion object {
        fun fromTag(tag: String): PulseLogCategory =
            entries.firstOrNull { it.tag == tag } ?: NativeEvent
    }
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
    private val kermit = Logger(PulseLoggerConfig.config, tag = category.tag)

    fun d(message: () -> String) = kermit.d(message = message)
    fun i(message: () -> String) = kermit.i(message = message)
    fun w(message: () -> String) = kermit.w(message = message)
    fun w(error: Throwable?, message: () -> String) = kermit.w(throwable = error, message = message)
    fun e(message: () -> String) = kermit.e(message = message)
    fun e(error: Throwable?, message: () -> String) = kermit.e(throwable = error, message = message)

    fun log(level: PulseLogLevel, message: String) {
        when (level) {
            PulseLogLevel.Debug -> d { message }
            PulseLogLevel.Info -> i { message }
            PulseLogLevel.Warn -> w { message }
            PulseLogLevel.Error -> e { message }
        }
    }
}

fun logger(category: PulseLogCategory): PulseBarLog = PulseBarLog(category)

enum class PulseNativeLogCategory(val logCategory: PulseLogCategory) {
    platformAdapter(PulseLogCategory.PlatformAdapter),
    streamSession(PulseLogCategory.StreamSession),
}

object PulseNativeLog {
    fun debug(category: PulseNativeLogCategory, message: String) =
        logger(category.logCategory).log(PulseLogLevel.Debug, message)

    fun info(category: PulseNativeLogCategory, message: String) =
        logger(category.logCategory).log(PulseLogLevel.Info, message)

    fun warn(category: PulseNativeLogCategory, message: String) =
        logger(category.logCategory).log(PulseLogLevel.Warn, message)
}

internal object PulseLoggerConfig {
    val config by lazy { platformLoggerConfig() }
}

internal expect fun platformLoggerConfig(): co.touchlab.kermit.LoggerConfig
