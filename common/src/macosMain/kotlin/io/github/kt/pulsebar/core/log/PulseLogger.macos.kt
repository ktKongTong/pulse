package io.github.kt.pulsebar.core.log

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSLog
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Foundation.writeToFile

@OptIn(ExperimentalForeignApi::class)
private val logFilePath: String by lazy {
    val dir = NSHomeDirectory() + "/Library/Logs/PulseBarNative"
    NSFileManager.defaultManager.createDirectoryAtPath(dir, withIntermediateDirectories = true, attributes = null, error = null)
    "$dir/pulse.log"
}

private val dateFormatter: NSDateFormatter by lazy {
    NSDateFormatter().apply { dateFormat = "HH:mm:ss.SSS" }
}

@OptIn(ExperimentalForeignApi::class)
internal actual fun platformLog(
    level: PulseLogLevel,
    category: PulseLogCategory,
    message: String,
    error: Throwable?,
) {
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
    NSLog("%s", line)

    // File log stays at Info+ to keep the file readable. Debug-level
    // entries are still emitted to NSLog (stderr) when launched from a
    // terminal, so raising the file threshold doesn't hide anything.
    if (level != PulseLogLevel.Debug) {
        val ts = dateFormatter.stringFromDate(NSDate())
        val fileLine = "$ts $line\n"
        appendToLogFile(fileLine)
    }
}

@OptIn(ExperimentalForeignApi::class)
private fun appendToLogFile(line: String) {
    val fileManager = NSFileManager.defaultManager
    if (!fileManager.fileExistsAtPath(logFilePath)) {
        fileManager.createFileAtPath(logFilePath, contents = null, attributes = null)
    }
    // Read existing content, append, write back. Not efficient but simple and
    // only used for debug logging.
    val existing = NSString.create(contentsOfFile = logFilePath, encoding = NSUTF8StringEncoding, error = null) ?: ""
    val updated = "$existing$line"
    @Suppress("CAST_NEVER_SUCCEEDS")
    (updated as NSString).writeToFile(logFilePath, atomically = true, encoding = NSUTF8StringEncoding, error = null)
}
