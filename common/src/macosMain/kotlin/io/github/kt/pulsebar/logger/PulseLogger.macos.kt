package io.github.kt.pulsebar.logger

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSLog
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

@OptIn(ExperimentalForeignApi::class)
internal actual fun platformLog(
    level: PulseLogLevel,
    category: PulseLogCategory,
    message: String,
    error: Throwable?,
) {
    ensureConfig()
    val prefix = when (level) {
        PulseLogLevel.Debug -> "D"
        PulseLogLevel.Info -> "I"
        PulseLogLevel.Warn -> "W"
        PulseLogLevel.Error -> "E"
    }
    val line = if (error == null) {
        "[$prefix][${category.tag}] $message"
    } else {
        "[$prefix][${category.tag}] $message -- ${error::class.simpleName}: ${error.message ?: ""}"
    }

    if (PulseLogConfig.shouldEmit(PulseLogConfig.stderrLevel, level)) {
        NSLog("%s", line)
    }

    if (PulseLogConfig.shouldEmit(PulseLogConfig.fileLevel, level)) {
        val ts = dateFormatter.stringFromDate(NSDate())
        appendToLogFile("$ts $line\n")
    }
}

private fun appendToLogFile(line: String) {
    val sink = FileSystem.SYSTEM.appendingSink(logFilePath.toPath()).buffer()
    try {
        sink.writeUtf8(line)
    } finally {
        sink.close()
    }
}
