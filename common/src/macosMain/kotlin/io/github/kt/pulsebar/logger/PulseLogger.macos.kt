package io.github.kt.pulsebar.logger

import co.touchlab.kermit.LogWriter
import co.touchlab.kermit.LoggerConfig
import co.touchlab.kermit.Severity
import co.touchlab.kermit.loggerConfigInit
import co.touchlab.kermit.platformLogWriter
import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSProcessInfo
import okio.FileSystem
import okio.Path.Companion.toPath
import okio.buffer

@OptIn(ExperimentalForeignApi::class)
private val logFilePath: String by lazy {
    val dir = NSHomeDirectory() + "/Library/Logs/PulseBarNative"
    NSFileManager.defaultManager.createDirectoryAtPath(dir, withIntermediateDirectories = true, attributes = null, error = null)
    "$dir/pulse.log"
}

private val dateFormatter: NSDateFormatter by lazy {
    NSDateFormatter().apply { dateFormat = "HH:mm:ss.SSS" }
}

private var configInitialized = false

private fun ensureConfig() {
    if (configInitialized) return
    val env = NSProcessInfo.processInfo.environment
    val global = PulseLogConfig.parseLevel(env["PULSE_LOG_LEVEL"] as? String)
    val stderr = PulseLogConfig.parseLevel(env["PULSE_LOG_STDERR_LEVEL"] as? String) ?: global
    val file = PulseLogConfig.parseLevel(env["PULSE_LOG_FILE_LEVEL"] as? String) ?: global
    if (stderr != null) PulseLogConfig.stderrLevel = stderr
    if (file != null) PulseLogConfig.fileLevel = file
    configInitialized = true
}

internal actual fun platformLoggerConfig(): LoggerConfig {
    ensureConfig()
    return loggerConfigInit(
        FilteringLogWriter(PulseLogConfig.stderrLevel, platformLogWriter()),
        PulseFileLogWriter(),
        minSeverity = Severity.Debug,
    )
}

private fun appendToLogFile(line: String) {
    val sink = FileSystem.SYSTEM.appendingSink(logFilePath.toPath()).buffer()
    try {
        sink.writeUtf8(line)
    } finally {
        sink.close()
    }
}

private class FilteringLogWriter(
    private val minLevel: PulseLogLevel,
    private val delegate: LogWriter,
) : LogWriter() {
    override fun isLoggable(tag: String, severity: Severity): Boolean =
        PulseLogConfig.shouldEmit(minLevel, severity.toPulseLogLevel())

    override fun log(severity: Severity, message: String, tag: String, throwable: Throwable?) {
        delegate.log(severity, message, tag, throwable)
    }
}

private class PulseFileLogWriter : LogWriter() {
    override fun isLoggable(tag: String, severity: Severity): Boolean =
        PulseLogConfig.shouldEmit(PulseLogConfig.fileLevel, severity.toPulseLogLevel())

    override fun log(severity: Severity, message: String, tag: String, throwable: Throwable?) {
        val category = PulseLogCategory.fromTag(tag)
        val level = severity.toPulseLogLevel()
        val line = if (throwable == null) {
            "[${levelPrefix(level)}][${category.tag}] $message"
        } else {
            "[${levelPrefix(level)}][${category.tag}] $message -- ${throwable::class.simpleName}: ${throwable.message ?: ""}"
        }
        val ts = dateFormatter.stringFromDate(NSDate())
        appendToLogFile("$ts $line\n")
    }
}

private fun Severity.toPulseLogLevel(): PulseLogLevel = when (this) {
    Severity.Verbose,
    Severity.Debug -> PulseLogLevel.Debug
    Severity.Info -> PulseLogLevel.Info
    Severity.Warn -> PulseLogLevel.Warn
    Severity.Error,
    Severity.Assert -> PulseLogLevel.Error
}

private fun levelPrefix(level: PulseLogLevel): String = when (level) {
    PulseLogLevel.Debug -> "D"
    PulseLogLevel.Info -> "I"
    PulseLogLevel.Warn -> "W"
    PulseLogLevel.Error -> "E"
}
